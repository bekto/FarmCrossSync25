import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_BASE_URLS,
  isAppEnv,
  resolveApiBaseUrl,
  resolveAppEnv,
} from "./config.ts";

test("resolveAppEnv selects local/staging/production and defaults to local", () => {
  assert.equal(resolveAppEnv("local"), "local");
  assert.equal(resolveAppEnv("staging"), "staging");
  assert.equal(resolveAppEnv("production"), "production");
  assert.equal(resolveAppEnv(undefined), "local");
  assert.equal(resolveAppEnv("qa"), "local");
});

test("each environment resolves to a distinct API base URL", () => {
  const local = resolveApiBaseUrl("local");
  const staging = resolveApiBaseUrl("staging");
  const production = resolveApiBaseUrl("production");

  assert.equal(local, "http://localhost:8787");
  assert.ok(staging.startsWith("https://"));
  assert.ok(production.startsWith("https://"));
  assert.equal(new Set([local, staging, production]).size, 3);
  assert.deepEqual(Object.keys(API_BASE_URLS).sort(), [
    "local",
    "production",
    "staging",
  ]);
});

test("isAppEnv rejects unknown values", () => {
  assert.equal(isAppEnv("staging"), true);
  assert.equal(isAppEnv(""), false);
  assert.equal(isAppEnv(undefined), false);
});
