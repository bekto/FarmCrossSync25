// Session expiry and revocation tests for the Worker HTTP surface (ticket 83).
//
// Integration-style: the real Hono app driven through `app.request()` with the
// in-process D1/R2 stand-ins from `test-harness.mjs` (see its header for the
// rationale). Sessions are exercised through the real `requireAuth` middleware
// and the real `sessions` table (migrations 0002 + 0006), so expiry,
// revocation, and re-registration are verified at the HTTP boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SESSION_TTL_MS } from "./identity.ts";
import { makeEnv, req, registerUser } from "./test-harness.mjs";

// Same hashing the Worker uses (SHA-256 hex of the raw token), so tests can
// address a specific session row.
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const iso = (ms) => new Date(ms).toISOString();

const setExpiry = (env, token, expiresAt) =>
  env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
    .bind(expiresAt, tokenHash(token))
    .run();

test("session expiry and revocation (integration)", async (t) => {
  await t.test("a valid session is accepted on protected routes", async () => {
    const env = makeEnv();
    const alice = await registerUser(env, "inst-valid", "Alice");

    const me = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, alice.user.id);

    const farms = await req(env, "GET", "/farms", { token: alice.token });
    assert.equal(farms.status, 200);
  });

  await t.test("register stores an expiry one SESSION_TTL_MS in the future", async () => {
    assert.equal(SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000, "30 days");

    const env = makeEnv();
    await registerUser(env, "inst-expiry", "Alice");
    const row = await env.DB.prepare("SELECT expires_at FROM sessions").first();
    assert.ok(row.expires_at, "session row carries an expiry");
    const delta = Date.parse(row.expires_at) - Date.now();
    assert.ok(delta > SESSION_TTL_MS - 60_000, "expires ~30 days out");
    assert.ok(delta <= SESSION_TTL_MS, "never beyond the issued lifetime");
  });

  await t.test("expired sessions are rejected by protected routes, exactly like missing tokens", async () => {
    const env = makeEnv();
    const alice = await registerUser(env, "inst-expired", "Alice");
    await setExpiry(env, alice.token, iso(Date.now() - 1000));

    for (const [method, url] of [
      ["GET", "/me"],
      ["GET", "/farms"],
      ["GET", "/farms/some-farm/members"],
    ]) {
      const expired = await req(env, method, url, { token: alice.token });
      assert.equal(expired.status, 401, `${method} ${url} rejects expired`);
      assert.deepEqual(expired.json, { error: "unauthorized" });

      // Byte-identical to the missing-token response: the caller cannot
      // distinguish expiry from revocation.
      const missing = await req(env, method, url);
      assert.equal(missing.status, 401);
      assert.deepEqual(missing.json, expired.json);
    }
  });

  await t.test("a session without a usable expiry fails closed", async () => {
    const env = makeEnv();
    const alice = await registerUser(env, "inst-no-expiry", "Alice");

    await setExpiry(env, alice.token, null);
    const nulled = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(nulled.status, 401);
    assert.deepEqual(nulled.json, { error: "unauthorized" });

    await setExpiry(env, alice.token, "not-a-timestamp");
    const garbage = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(garbage.status, 401);
    assert.deepEqual(garbage.json, { error: "unauthorized" });
  });

  await t.test("POST /logout revokes only the calling session", async () => {
    const env = makeEnv();
    // Two sessions for the same installation: register is idempotent on the
    // user and mints a fresh token each call.
    const first = await registerUser(env, "inst-logout", "Alice");
    const second = await registerUser(env, "inst-logout", "Alice");

    const out = await req(env, "POST", "/logout", { token: first.token });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { ok: true });

    // The revoked token is dead...
    const dead = await req(env, "GET", "/me", { token: first.token });
    assert.equal(dead.status, 401);
    assert.deepEqual(dead.json, { error: "unauthorized" });

    // ...and logging out again with it is the same 401.
    const again = await req(env, "POST", "/logout", { token: first.token });
    assert.equal(again.status, 401);
    assert.deepEqual(again.json, { error: "unauthorized" });

    // The other session survives: exactly one row remains, the second's.
    const alive = await req(env, "GET", "/me", { token: second.token });
    assert.equal(alive.status, 200);
    const rows = await env.DB.prepare("SELECT token_hash FROM sessions").all();
    assert.deepEqual(
      rows.results.map((r) => r.token_hash),
      [tokenHash(second.token)],
    );
  });

  await t.test("POST /logout without a valid token is 401", async () => {
    const env = makeEnv();
    for (const token of [undefined, "", "not-a-real-token"]) {
      const res = await req(env, "POST", "/logout", { token });
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { error: "unauthorized" });
    }
  });

  await t.test("re-registering issues a new session and never resurrects a revoked one", async () => {
    const env = makeEnv();
    const first = await registerUser(env, "inst-revive", "Alice");
    const out = await req(env, "POST", "/logout", { token: first.token });
    assert.equal(out.status, 200);

    const second = await registerUser(env, "inst-revive", "Alice");
    assert.notEqual(second.token, first.token, "a fresh random token");
    assert.equal(second.user.id, first.user.id, "same user, idempotent register");

    const fresh = await req(env, "GET", "/me", { token: second.token });
    assert.equal(fresh.status, 200, "the new session works");

    const stale = await req(env, "GET", "/me", { token: first.token });
    assert.equal(stale.status, 401, "the revoked session stays dead");
    assert.deepEqual(stale.json, { error: "unauthorized" });
  });
});
