// Shared harness for the Worker HTTP-surface tests.
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

  async get(key) {
    const bytes = this.store.get(key);
    return bytes ? { key, size: bytes.byteLength, body: bytes } : null;
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

const makeEnv = (extra = {}) => ({
  DB: new FakeD1(),
  BUCKET: new FakeR2(),
  ...extra,
});

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

export {
  app,
  FakeD1,
  FakeR2,
  makeEnv,
  req,
  registerUser,
  createFarm,
  requestJoin,
  addMember,
  saveKey,
  uploadSave,
};
