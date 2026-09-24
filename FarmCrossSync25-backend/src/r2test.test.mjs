// Development-only R2 route isolation (ticket 77).
//
// The `/r2-test/*` route must be a local-development affordance only. It is
// gated by a fail-closed stack — ENABLE_R2_TEST (switch) +
// FARM_CROSSSYNC_LOCAL_DEV (explicit local-only marker) + loopback Host — and
// its key space is confined to `farms/{farmId}/players/{userId}/save` keys so
// it cannot address arbitrary bucket keys. The deploy-time guard
// (`scripts/deploy-guard.mjs`) additionally refuses to deploy a config that
// sets the dev vars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app, makeEnv } from "./test-harness.mjs";
import { findDeployedDevVars, stripJsonComments } from "../scripts/deploy-guard.mjs";

const KEY = "farms/f1/players/u1/save";
const ENC = (key) => key.split("/").join("%2F");

const LOCAL_ENV = { ENABLE_R2_TEST: "true", FARM_CROSSSYNC_LOCAL_DEV: "true" };
const LOCAL_BASE = "http://127.0.0.1:8787";

const put = (env, base, key, bytes = new Uint8Array([1, 2, 3])) =>
  app.request(`${base}/r2-test/${ENC(key)}`, { method: "PUT", body: bytes }, env);
const get = (env, base, key) =>
  app.request(`${base}/r2-test/${ENC(key)}`, { method: "GET" }, env);

test("dev-only R2 route (ticket 77)", async (t) => {
  await t.test("disabled by default: the route 404s without the switch", async () => {
    const env = makeEnv();
    assert.equal((await put(env, LOCAL_BASE, KEY)).status, 404);
    assert.equal((await get(env, LOCAL_BASE, KEY)).status, 404);

    // The switch alone must not enable it either; the local marker is required.
    const switchedOnly = makeEnv({ ENABLE_R2_TEST: "true" });
    assert.equal((await put(switchedOnly, LOCAL_BASE, KEY)).status, 403);
  });

  await t.test("enabled only under the full local condition (round trip works)", async () => {
    const env = makeEnv(LOCAL_ENV);
    const bytes = new Uint8Array([9, 8, 7, 6]);

    const putRes = await put(env, "http://localhost:8787", KEY, bytes);
    assert.equal(putRes.status, 200, "PUT under the full local condition");

    const getRes = await get(env, LOCAL_BASE, KEY);
    assert.equal(getRes.status, 200);
    const roundTripped = new Uint8Array(await getRes.arrayBuffer());
    assert.deepEqual(roundTripped, bytes, "bytes unchanged");
  });

  await t.test("rejected outside local development", async () => {
    const env = makeEnv(LOCAL_ENV);

    // Non-loopback host: everything set, but not local dev -> rejected.
    for (const base of ["https://farms.example.com", "http://10.0.0.5:8787"]) {
      const res = await put(env, base, KEY);
      assert.equal(res.status, 403, `${base} must be rejected`);
      assert.deepEqual(await res.json(), { error: "r2_test_local_only" });
    }

    // Missing local-only marker (e.g. production set the switch as a secret).
    const noMarker = makeEnv({ ENABLE_R2_TEST: "true" });
    const markerless = await put(noMarker, LOCAL_BASE, KEY);
    assert.equal(markerless.status, 403);
    assert.deepEqual(await markerless.json(), { error: "r2_test_local_only" });

    // Marker without the switch stays hidden entirely.
    const noSwitch = makeEnv({ FARM_CROSSSYNC_LOCAL_DEV: "true" });
    assert.equal((await put(noSwitch, LOCAL_BASE, KEY)).status, 404);
  });

  await t.test("rejected for disallowed keys (traversal and unexpected shapes)", async () => {
    const env = makeEnv(LOCAL_ENV);
    for (const key of [
      "farms/../players/u1/save",
      "farms/f1/players/../save",
      "roundtrip-check",
      "some/other/key",
      "farms/f1/players/u1/other",
      "farms/f1/players/u1/save/extra",
      "farms//players/u1/save",
      "farms/f1/players/u1/save%2F..%2F..%2Fsecret",
    ]) {
      const res = await put(env, LOCAL_BASE, key);
      assert.equal(res.status, 400, `${key} must be rejected`);
      assert.deepEqual(await res.json(), { error: "invalid_key" });
      assert.equal((await get(env, LOCAL_BASE, key)).status, 400, `GET ${key}`);
    }

    // Traversal as a whole path segment never reaches the handler: URL
    // parsing collapses dot-segments (`..`, `%2E%2E`) before routing, so the
    // request 404s without ever addressing the bucket.
    for (const raw of ["..", "%2E%2E", "farms/%2E%2E/players/u1/save"]) {
      const res = await app.request(
        `${LOCAL_BASE}/r2-test/${raw}`,
        { method: "PUT", body: new Uint8Array([1]) },
        env,
      );
      assert.notEqual(res.status, 200, `${raw} must not write`);
      assert.ok(res.status === 404 || res.status === 400, `${raw} rejected`);
    }
  });

  await t.test("deploy guard keeps dev vars out of the shipped config", async () => {
    // The real wrangler config must carry none of the dev-only vars.
    const shipped = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.deepEqual(findDeployedDevVars(shipped), []);

    // ...and the guard trips on any vars block that sets them.
    assert.deepEqual(
      findDeployedDevVars('{"vars": {"ENABLE_R2_TEST": "true"}}'),
      ["ENABLE_R2_TEST"],
    );
    assert.deepEqual(
      findDeployedDevVars(
        '{"env": {"production": {"vars": {"FARM_CROSSSYNC_LOCAL_DEV": "true"}}}}',
      ),
      ["FARM_CROSSSYNC_LOCAL_DEV"],
    );
    assert.deepEqual(
      findDeployedDevVars('{"vars": {"OTHER": "1"}}'),
      [],
    );
    // JSONC comments are stripped before parsing; mentioning a var in a
    // comment is not a deployment of it.
    assert.deepEqual(
      findDeployedDevVars('// ENABLE_R2_TEST=true belongs in .dev.vars\n{"vars": {}}'),
      [],
    );
    assert.equal(stripJsonComments('{"a": "https://x//y" /* c */}'), '{"a": "https://x//y" }');
  });
});
