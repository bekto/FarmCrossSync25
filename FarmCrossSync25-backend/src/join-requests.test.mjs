// Unique pending join requests (ticket 82).
//
// At most one active (pending) join request may exist per user per farm,
// guaranteed by the partial unique index `idx_farm_invites_pending_unique`
// (migrations/0005_unique_pending_join_requests.sql). Concurrent duplicates
// surface as the existing-request result (409 "pending request"), not a 500.
// A denied user can still submit a fresh pending request — the index covers
// `status = 'pending'` only, so denied rows never block it and are never
// reopened. The owner's invite list is therefore free of duplicate active
// requests for the same user by construction.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv,
  req,
  registerUser,
  createFarm,
  requestJoin,
} from "./test-harness.mjs";

const pendingRows = (env, farmId, userId) =>
  env.DB.prepare(
    "SELECT id, status FROM farm_invites WHERE farm_id = ?1 AND user_id = ?2 ORDER BY created_at ASC, id ASC",
  )
    .bind(farmId, userId)
    .all()
    .then((r) => r.results);

const invitesOf = (env, token, farmId) =>
  req(env, "GET", `/farms/${farmId}/invites`, { token });

test("unique pending join requests (ticket 82)", async (t) => {
  await t.test("concurrent duplicate joins create exactly one pending request", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "uq-owner", "Owner");
    const farm = await createFarm(env, owner.token, "UQ Farm");
    const joiner = await registerUser(env, "uq-racer", "Racer");

    const [r1, r2] = await Promise.all([
      req(env, "POST", `/farms/${farm.id}/join`, {
        token: joiner.token,
        body: { code: farm.code },
      }),
      req(env, "POST", `/farms/${farm.id}/join`, {
        token: joiner.token,
        body: { code: farm.code },
      }),
    ]);

    // Exactly one creates the request; the duplicate is the existing-request
    // result, whether it lost the insert race or saw the row at the check.
    assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    assert.deepEqual(loser.json, { error: "pending request" });

    const rows = await pendingRows(env, farm.id, joiner.user.id);
    assert.equal(rows.length, 1, "exactly one pending row in the database");
    assert.equal(rows[0].status, "pending");

    // The owner's invite list shows the user exactly once.
    const list = await invitesOf(env, owner.token, farm.id);
    assert.equal(list.status, 200);
    const forUser = list.json.invites.filter((i) => i.user_id === joiner.user.id);
    assert.equal(forUser.length, 1, "one active request in the owner's list");
  });

  await t.test("a pending user receives the existing-request result", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "uq-pending-owner", "Owner");
    const farm = await createFarm(env, owner.token, "UQ Farm");
    const joiner = await registerUser(env, "uq-pending", "Pending");

    const first = await req(env, "POST", `/farms/${farm.id}/join`, {
      token: joiner.token,
      body: { code: farm.code },
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.invite.status, "pending");

    const second = await req(env, "POST", `/farms/${farm.id}/join`, {
      token: joiner.token,
      body: { code: farm.code },
    });
    assert.equal(second.status, 409);
    assert.deepEqual(second.json, { error: "pending request" });
    assert.equal((await pendingRows(env, farm.id, joiner.user.id)).length, 1);
  });

  await t.test("a denied user can create a new pending request", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "uq-denied-owner", "Owner");
    const farm = await createFarm(env, owner.token, "UQ Farm");
    const joiner = await registerUser(env, "uq-denied", "Denied");

    const first = await requestJoin(env, joiner.token, farm);
    const deny = await req(env, "POST", `/invites/${first.id}/deny`, {
      token: owner.token,
    });
    assert.equal(deny.status, 200);
    assert.equal(deny.json.invite.status, "denied");

    // A new request is a NEW row: the denied row is history, never reopened.
    const again = await req(env, "POST", `/farms/${farm.id}/join`, {
      token: joiner.token,
      body: { code: farm.code },
    });
    assert.equal(again.status, 201, "denied user may request again");
    assert.equal(again.json.invite.status, "pending");
    assert.notEqual(again.json.invite.id, first.id, "a fresh pending row");

    const rows = await pendingRows(env, farm.id, joiner.user.id);
    assert.equal(rows.length, 2, "history kept: one denied, one pending");
    assert.deepEqual(
      rows.map((r) => r.status).sort(),
      ["denied", "pending"],
    );

    // And the owner's list contains exactly one active request for the user.
    const list = await invitesOf(env, owner.token, farm.id);
    const forUser = list.json.invites.filter((i) => i.user_id === joiner.user.id);
    assert.equal(forUser.length, 1);
    assert.equal(forUser[0].id, again.json.invite.id);
  });

  await t.test("owner invite lists contain no duplicate active requests", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "uq-list-owner", "Owner");
    const farm = await createFarm(env, owner.token, "UQ Farm");

    // Two users, each with a racing duplicate join and a denied history.
    for (const name of ["uq-list-a", "uq-list-b"]) {
      const user = await registerUser(env, name, name);
      const first = await requestJoin(env, user.token, farm);
      await req(env, "POST", `/invites/${first.id}/deny`, { token: owner.token });
      await Promise.all([
        req(env, "POST", `/farms/${farm.id}/join`, {
          token: user.token,
          body: { code: farm.code },
        }),
        req(env, "POST", `/farms/${farm.id}/join`, {
          token: user.token,
          body: { code: farm.code },
        }),
      ]);
    }

    const list = await invitesOf(env, owner.token, farm.id);
    assert.equal(list.status, 200);
    const userIds = list.json.invites.map((i) => i.user_id);
    assert.equal(userIds.length, new Set(userIds).size, "one active request per user");
    assert.equal(userIds.length, 2);
  });

  await t.test("the schema rejects a second pending row outright", async () => {
    // Database-level invariant (migrations/0005): the unique index holds even
    // when the handler is bypassed entirely.
    const env = makeEnv();
    const insert = (id) =>
      env.DB.prepare(
        "INSERT INTO farm_invites (id, farm_id, user_id, status, created_at) VALUES (?, 'f1', 'u1', 'pending', '2026-01-01T00:00:00.000Z')",
      )
        .bind(id)
        .run();
    await insert("i1");
    await assert.rejects(() => insert("i2"), /unique/i);

    // Denied rows do not collide: a denied history plus one pending is fine.
    await env.DB.prepare(
      "INSERT INTO farm_invites (id, farm_id, user_id, status, created_at) VALUES ('i3', 'f1', 'u1', 'denied', '2026-01-01T00:00:00.000Z')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO farm_invites (id, farm_id, user_id, status, created_at) VALUES ('i4', 'f1', 'u1', 'denied', '2026-01-02T00:00:00.000Z')",
    ).run();
  });
});
