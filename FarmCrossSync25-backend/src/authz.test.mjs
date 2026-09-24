// Authorization tests for the Worker HTTP surface (ticket 46).
//
// These are integration-style: they import the real Hono app from
// `src/index.ts` and drive it through `app.request()`, exercising routing,
// the `requireAuth` middleware, farm-membership lookups, and every handler's
// status codes and response shapes. The bindings are real enough to be
// meaningful but fully in-process and deterministic:
//
//   * `DB`  — a D1 shim over Node's built-in `node:sqlite`, loaded with the
//             real migrations, so the actual SQL in the handlers runs.
//   * `BUCKET` — an in-memory R2 stand-in (only the methods the routes use).
//
// This keeps `npm test` fast and non-flaky (no server process, no network, no
// ports) while still verifying the rules at the HTTP boundary rather than only
// at the pure-helper level (those helpers stay covered in farms.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register as registerModule } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

registerModule(new URL("./ts-resolve-hooks.mjs", import.meta.url));
const { default: app } = await import("./index.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");
const SCHEMA = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(migrationsDir, file), "utf8"))
  .join("\n");

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (row === undefined || row === null) return null;
    return column ? row[column] : row;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: {} };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
    };
  }
}

class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(SCHEMA);
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class FakeR2 {
  constructor() {
    this.store = new Map();
  }

  async put(key, value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.store.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async head(key) {
    const bytes = this.store.get(key);
    return bytes ? { key, size: bytes.byteLength } : null;
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }

  async list({ prefix = "" } = {}) {
    const objects = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => ({ key }));
    return { objects, truncated: false, cursor: undefined };
  }
}

const makeEnv = () => ({ DB: new FakeD1(), BUCKET: new FakeR2() });

async function req(env, method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(url, init, env);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function registerUser(env, installationId, displayName) {
  const { status, json } = await req(env, "POST", "/register", {
    body: { installationId, displayName },
  });
  assert.equal(status, 200, `register ${installationId} should succeed`);
  return json;
}

async function createFarm(env, token, name) {
  const { status, json } = await req(env, "POST", "/farms", {
    token,
    body: { name },
  });
  assert.equal(status, 201, "create farm should succeed");
  return json.farm;
}

async function requestJoin(env, token, farm) {
  const { status, json } = await req(env, "POST", `/farms/${farm.id}/join`, {
    token,
    body: { code: farm.code },
  });
  assert.equal(status, 201, "join request should be created");
  return json.invite;
}

async function addMember(env, owner, memberToken, farm) {
  const invite = await requestJoin(env, memberToken, farm);
  const { status } = await req(env, "POST", `/invites/${invite.id}/accept`, {
    token: owner.token,
  });
  assert.equal(status, 200, "owner accept should succeed");
  return invite;
}

const saveKey = (farmId, userId) =>
  `farms/${farmId}/players/${userId}/save`;

async function uploadSave(env, token, farmId, userId, content) {
  const key = saveKey(farmId, userId);
  const bytes = new TextEncoder().encode(content);
  await env.BUCKET.put(key, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { status } = await req(env, "POST", "/saves/upload-complete", {
    token,
    body: {
      farmId,
      objectKey: key,
      saveName: "Save",
      fileSize: bytes.byteLength,
      sha256,
    },
  });
  assert.equal(status, 200, "upload-complete should succeed");
  return key;
}

// One owner + one member in farm A, one outsider, and an unrelated owner of
// farm B. Every subtest builds a fresh environment so state cannot leak.
async function freshFarm(label) {
  const env = makeEnv();
  const owner = await registerUser(env, `owner-${label}`, "Owner");
  const member = await registerUser(env, `member-${label}`, "Member");
  const outsider = await registerUser(env, `outsider-${label}`, "Outsider");
  const other = await registerUser(env, `other-${label}`, "Other");
  const farm = await createFarm(env, owner.token, "Farm A");
  const otherFarm = await createFarm(env, other.token, "Farm B");
  await addMember(env, owner, member.token, farm);
  return { env, owner, member, outsider, other, farm, otherFarm };
}

test("authorization rules (integration)", async (t) => {
  await t.test("registration is idempotent on the same installation_id", async () => {
    const env = makeEnv();
    const first = await registerUser(env, "same-install", "Alice");
    const second = await registerUser(env, "same-install", "Alice");

    assert.equal(second.user.id, first.user.id, "same user id on re-register");
    assert.notEqual(second.token, first.token, "a new token is issued");

    const me1 = await req(env, "GET", "/me", { token: first.token });
    const me2 = await req(env, "GET", "/me", { token: second.token });
    assert.equal(me1.status, 200);
    assert.equal(me2.status, 200);
    assert.equal(me1.json.user.id, first.user.id);
    assert.equal(me2.json.user.id, first.user.id);
  });

  await t.test("upload-authorize grants only the caller's own slot", async () => {
    const { env, owner, member, outsider, farm } = await freshFarm("upload");

    const own = await req(env, "POST", "/saves/upload-authorize", {
      token: member.token,
      body: { farmId: farm.id },
    });
    assert.equal(own.status, 200);
    assert.equal(own.json.authorization.objectKey, saveKey(farm.id, member.user.id));
    assert.equal(own.json.authorization.method, "PUT");

    const otherSlot = await req(env, "POST", "/saves/upload-authorize", {
      token: member.token,
      body: {
        farmId: farm.id,
        objectKey: saveKey(farm.id, owner.user.id),
      },
    });
    assert.equal(otherSlot.status, 403, "another user's slot is forbidden");

    const nonMember = await req(env, "POST", "/saves/upload-authorize", {
      token: outsider.token,
      body: { farmId: farm.id },
    });
    assert.equal(nonMember.status, 403, "non-member is forbidden");
  });

  await t.test("download-authorize allows any member, blocks everyone else", async () => {
    const { env, owner, member, outsider, other, farm } = await freshFarm("download");
    const ownerKey = await uploadSave(env, owner.token, farm.id, owner.user.id, "owner-save");

    const asMember = await req(env, "POST", `/saves/${owner.user.id}/download-authorize`, {
      token: member.token,
      body: { farmId: farm.id },
    });
    assert.equal(asMember.status, 200);
    assert.equal(asMember.json.authorization.objectKey, ownerKey);
    assert.equal(asMember.json.authorization.method, "GET");

    const asOwner = await req(env, "POST", `/saves/${owner.user.id}/download-authorize`, {
      token: owner.token,
      body: { farmId: farm.id },
    });
    assert.equal(asOwner.status, 200, "own save is downloadable too");

    const asOutsider = await req(env, "POST", `/saves/${owner.user.id}/download-authorize`, {
      token: outsider.token,
      body: { farmId: farm.id },
    });
    assert.equal(asOutsider.status, 403, "non-member is forbidden");

    const fromOtherFarm = await req(env, "POST", `/saves/${owner.user.id}/download-authorize`, {
      token: other.token,
      body: { farmId: farm.id },
    });
    assert.equal(fromOtherFarm.status, 403, "member of another farm is forbidden");

    const nonMemberTarget = await req(env, "POST", `/saves/${other.user.id}/download-authorize`, {
      token: owner.token,
      body: { farmId: farm.id },
    });
    assert.equal(nonMemberTarget.status, 404, "target not in this farm");
  });

  await t.test("no cross-farm access: farm A member cannot read or act on farm B", async () => {
    const { env, member, other, otherFarm } = await freshFarm("cross");

    for (const url of [
      `/farms/${otherFarm.id}`,
      `/farms/${otherFarm.id}/members`,
      `/farms/${otherFarm.id}/saves`,
      `/farms/${otherFarm.id}/invites`,
    ]) {
      const res = await req(env, "GET", url, { token: member.token });
      assert.equal(res.status, 403, `${url} should be forbidden`);
    }

    const upload = await req(env, "POST", "/saves/upload-authorize", {
      token: member.token,
      body: { farmId: otherFarm.id },
    });
    assert.equal(upload.status, 403);

    const kick = await req(env, "DELETE", `/farms/${otherFarm.id}/members/${other.user.id}`, {
      token: member.token,
    });
    assert.equal(kick.status, 403);

    const transfer = await req(env, "POST", `/farms/${otherFarm.id}/transfer-owner`, {
      token: member.token,
      body: { userId: other.user.id },
    });
    assert.equal(transfer.status, 403);
  });

  await t.test("no self-accept: the requester cannot accept or deny their own request", async () => {
    const { env, member, outsider, farm } = await freshFarm("selfaccept");
    const invite = await requestJoin(env, outsider.token, farm);

    const selfAccept = await req(env, "POST", `/invites/${invite.id}/accept`, {
      token: outsider.token,
    });
    assert.equal(selfAccept.status, 403, "requester cannot accept");

    const selfDeny = await req(env, "POST", `/invites/${invite.id}/deny`, {
      token: outsider.token,
    });
    assert.equal(selfDeny.status, 403, "requester cannot deny");

    const memberAccept = await req(env, "POST", `/invites/${invite.id}/accept`, {
      token: member.token,
    });
    assert.equal(memberAccept.status, 403, "a non-owner member cannot accept");

    const memberDeny = await req(env, "POST", `/invites/${invite.id}/deny`, {
      token: member.token,
    });
    assert.equal(memberDeny.status, 403, "a non-owner member cannot deny");

    const otherOwner = await registerUser(env, "other-owner", "Other");
    await createFarm(env, otherOwner.token, "Farm B");
    const crossAccept = await req(env, "POST", `/invites/${invite.id}/accept`, {
      token: otherOwner.token,
    });
    assert.equal(crossAccept.status, 403, "another farm's owner cannot accept");
  });

  await t.test("only the owner may accept or deny a join request", async () => {
    const { env, owner, farm } = await freshFarm("acceptdeny");

    const requester = await registerUser(env, "requester-accept", "Requester");
    const invite = await requestJoin(env, requester.token, farm);
    const accepted = await req(env, "POST", `/invites/${invite.id}/accept`, {
      token: owner.token,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.invite.status, "accepted");

    const members = await req(env, "GET", `/farms/${farm.id}/members`, {
      token: owner.token,
    });
    assert.ok(
      members.json.members.some(
        (m) => m.user_id === requester.user.id && m.role === "member",
      ),
      "accepted requester becomes a member",
    );

    const requester2 = await registerUser(env, "requester-deny", "Requester2");
    const invite2 = await requestJoin(env, requester2.token, farm);
    const denied = await req(env, "POST", `/invites/${invite2.id}/deny`, {
      token: owner.token,
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.json.invite.status, "denied");
  });

  await t.test("only the owner may kick another member; members may leave", async () => {
    const { env, owner, member, farm } = await freshFarm("kick");

    const third = await registerUser(env, "kick-third", "Third");
    await addMember(env, owner, third.token, farm);

    const memberKick = await req(
      env,
      "DELETE",
      `/farms/${farm.id}/members/${third.user.id}`,
      { token: member.token },
    );
    assert.equal(memberKick.status, 403, "a member cannot kick another member");

    const ownerKick = await req(
      env,
      "DELETE",
      `/farms/${farm.id}/members/${third.user.id}`,
      { token: owner.token },
    );
    assert.equal(ownerKick.status, 200);
    assert.equal(ownerKick.json.removed, third.user.id);

    const leave = await req(env, "DELETE", `/farms/${farm.id}/members/${member.user.id}`, {
      token: member.token,
    });
    assert.equal(leave.status, 200, "a member may remove themselves");
    assert.equal(leave.json.own, true);

    const other = await registerUser(env, "kick-other", "Other");
    await createFarm(env, other.token, "Farm B");
    const crossKick = await req(
      env,
      "DELETE",
      `/farms/${farm.id}/members/${owner.user.id}`,
      { token: other.token },
    );
    assert.equal(crossKick.status, 403, "a non-member cannot kick");
  });

  await t.test("only the owner may transfer ownership, to an existing other member", async () => {
    const { env, owner, member, outsider, farm } = await freshFarm("transfer");

    const memberTransfer = await req(env, "POST", `/farms/${farm.id}/transfer-owner`, {
      token: member.token,
      body: { userId: owner.user.id },
    });
    assert.equal(memberTransfer.status, 403, "a non-owner cannot transfer");

    const toNonMember = await req(env, "POST", `/farms/${farm.id}/transfer-owner`, {
      token: owner.token,
      body: { userId: outsider.user.id },
    });
    assert.equal(toNonMember.status, 404, "target must be a member");

    const toSelf = await req(env, "POST", `/farms/${farm.id}/transfer-owner`, {
      token: owner.token,
      body: { userId: owner.user.id },
    });
    assert.equal(toSelf.status, 400, "self-transfer is rejected");

    const ok = await req(env, "POST", `/farms/${farm.id}/transfer-owner`, {
      token: owner.token,
      body: { userId: member.user.id },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.farm.owner_id, member.user.id);
  });
});
