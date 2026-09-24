// R2 upload metadata and object integrity (ticket 78).
//
// `POST /saves/upload-complete` must only ever record metadata that matches the
// object actually stored in R2: the object must exist, its byte size must
// equal the client-reported `fileSize`, and it must fit the configured maximum.
// Every rejection path returns before the upsert, so the previous
// `player_saves` row stays authoritative (the upsert itself is a single atomic
// `INSERT ... ON CONFLICT` statement, which replaces at most one row).
//
// `sha256` is a client-asserted trust boundary (documented in the backend
// README): the Worker stores it, it never verifies object bytes against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_MAX_SAVE_SIZE_BYTES,
  maxSaveSizeBytes,
} from "./saves.ts";
import { makeEnv, req, registerUser, createFarm, addMember, saveKey } from "./test-harness.mjs";

const bytes = (text) => new TextEncoder().encode(text);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const complete = (env, token, farmId, userId, body = {}) =>
  req(env, "POST", "/saves/upload-complete", {
    token,
    body: {
      farmId,
      objectKey: saveKey(farmId, userId),
      saveName: "Save",
      sha256: sha256(bytes("archive-bytes")),
      fileSize: bytes("archive-bytes").length,
      ...body,
    },
  });

const rowOf = (env, farmId, userId) =>
  env.DB.prepare(
    "SELECT farm_id, user_id, object_key, file_size, sha256, save_name, uploaded_at FROM player_saves WHERE farm_id = ?1 AND user_id = ?2",
  )
    .bind(farmId, userId)
    .first();

test("upload metadata integrity (ticket 78)", async (t) => {
  // One owner + one member; every subtest re-uses the member's slot but starts
  // from an upload of a known-good object and asserts it survives rejections.
  const env = makeEnv();
  const owner = await registerUser(env, "int-owner", "Owner");
  const member = await registerUser(env, "int-member", "Member");
  const farm = await createFarm(env, owner.token, "Integrity Farm");
  await addMember(env, owner, member.token, farm);
  const key = saveKey(farm.id, member.user.id);

  // Seed: a valid upload whose metadata must survive every later rejection.
  const good = bytes("archive-bytes");
  await env.BUCKET.put(key, good);
  const seeded = await complete(env, member.token, farm.id, member.user.id);
  assert.equal(seeded.status, 200, "seed upload should succeed");
  const seededRow = await rowOf(env, farm.id, member.user.id);
  assert.equal(seededRow.file_size, good.length);
  assert.equal(seededRow.sha256, sha256(good));

  // The row that rejections must leave byte-for-byte intact; re-captured after
  // each intentional write.
  let baselineRow = seededRow;
  const assertSeedIntact = async (label) => {
    const row = await rowOf(env, farm.id, member.user.id);
    assert.deepEqual(row, baselineRow, `previous metadata survives ${label}`);
  };

  await t.test("valid object is accepted and replaces the row", async () => {
    const next = bytes("new-archive-bytes!");
    await env.BUCKET.put(key, next);
    const res = await complete(env, member.token, farm.id, member.user.id, {
      sha256: sha256(next),
      fileSize: next.length,
      saveName: "Save v2",
    });
    assert.equal(res.status, 200);
    const row = await rowOf(env, farm.id, member.user.id);
    assert.equal(row.save_name, "Save v2");
    assert.equal(row.file_size, next.length);
    assert.equal(row.sha256, sha256(next));
    // Reset to the seeded object+row for the rejection subtests.
    await env.BUCKET.put(key, good);
    const reset = await complete(env, member.token, farm.id, member.user.id, {
      sha256: sha256(good),
      fileSize: good.length,
    });
    assert.equal(reset.status, 200);
    const { uploaded_at: _t, ...stable } = await rowOf(env, farm.id, member.user.id);
    const { uploaded_at: _s, ...seededStable } = seededRow;
    assert.deepEqual(stable, seededStable, "reset restores the seeded row");
    baselineRow = await rowOf(env, farm.id, member.user.id);
  });

  await t.test("missing object is rejected and the previous row survives", async () => {
    await env.BUCKET.delete(key);
    const res = await complete(env, member.token, farm.id, member.user.id);
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: "object not found" });
    await assertSeedIntact("a missing object");
    await env.BUCKET.put(key, good);
  });

  await t.test("incorrect size is rejected and the previous row survives", async () => {
    const res = await complete(env, member.token, farm.id, member.user.id, {
      fileSize: good.length + 1,
    });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, {
      error: "size_mismatch",
      objectSize: good.length,
      reportedSize: good.length + 1,
    });
    await assertSeedIntact("a size mismatch");
  });

  await t.test("oversized object is rejected and the previous row survives", async () => {
    // Default cap: an object just over DEFAULT_MAX_SAVE_SIZE_BYTES is too big
    // even when the client reports it faithfully. FakeR2 stores sizes only, so
    // this is exercised against the maxSaveSizeBytes env plumbing with a small
    // configured cap instead of allocating a half-gigabyte object.
    const smallCap = makeEnv({ MAX_SAVE_SIZE_BYTES: "8" });
    const sOwner = await registerUser(smallCap, "cap-owner", "Owner");
    const sMember = await registerUser(smallCap, "cap-member", "Member");
    const sFarm = await createFarm(smallCap, sOwner.token, "Cap Farm");
    await addMember(smallCap, sOwner, sMember.token, sFarm);
    const sKey = saveKey(sFarm.id, sMember.user.id);

    const tiny = bytes("tiny");
    await smallCap.BUCKET.put(sKey, tiny);
    const ok = await complete(smallCap, sMember.token, sFarm.id, sMember.user.id, {
      sha256: sha256(tiny),
      fileSize: tiny.length,
    });
    assert.equal(ok.status, 200, "object within the cap is accepted");

    const big = bytes("1234567890"); // 10 bytes > 8-byte cap
    await smallCap.BUCKET.put(sKey, big);
    const res = await complete(smallCap, sMember.token, sFarm.id, sMember.user.id, {
      sha256: sha256(big),
      fileSize: big.length,
    });
    assert.equal(res.status, 413);
    assert.deepEqual(res.json, { error: "object_too_large", max: 8 });

    const row = await smallCap.DB.prepare(
      "SELECT file_size, sha256 FROM player_saves WHERE farm_id = ?1 AND user_id = ?2",
    )
      .bind(sFarm.id, sMember.user.id)
      .first();
    assert.equal(row.file_size, tiny.length, "previous row survives oversized");
    assert.equal(row.sha256, sha256(tiny));

    // Oversized wins over a mismatching report: the object's size is the truth.
    const liar = await complete(smallCap, sMember.token, sFarm.id, sMember.user.id, {
      sha256: sha256(big),
      fileSize: 1,
    });
    assert.equal(liar.status, 413);
    assert.deepEqual(liar.json, { error: "object_too_large", max: 8 });
  });

  await t.test("malformed metadata is rejected before any write", async () => {
    for (const body of [
      { sha256: "zz" },
      { sha256: "" },
      { fileSize: -1 },
      { fileSize: 1.5 },
      { fileSize: "12" },
      { saveName: "  " },
    ]) {
      const res = await complete(env, member.token, farm.id, member.user.id, body);
      assert.equal(res.status, 400, `rejects ${JSON.stringify(body)}`);
      await assertSeedIntact(`malformed metadata ${JSON.stringify(body)}`);
    }
  });

  await t.test("maxSaveSizeBytes defaults and validates", () => {
    assert.equal(DEFAULT_MAX_SAVE_SIZE_BYTES, 512 * 1024 * 1024);
    assert.equal(maxSaveSizeBytes({}), DEFAULT_MAX_SAVE_SIZE_BYTES);
    assert.equal(maxSaveSizeBytes({ MAX_SAVE_SIZE_BYTES: "1024" }), 1024);
    assert.equal(
      maxSaveSizeBytes({ MAX_SAVE_SIZE_BYTES: "0" }),
      DEFAULT_MAX_SAVE_SIZE_BYTES,
    );
    assert.equal(
      maxSaveSizeBytes({ MAX_SAVE_SIZE_BYTES: "banana" }),
      DEFAULT_MAX_SAVE_SIZE_BYTES,
    );
    assert.equal(
      maxSaveSizeBytes({ MAX_SAVE_SIZE_BYTES: "-5" }),
      DEFAULT_MAX_SAVE_SIZE_BYTES,
    );
  });
});
