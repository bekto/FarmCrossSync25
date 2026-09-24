import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession, NEED_INTERNET_MESSAGE } from "./session.ts";

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const calls = {
    stored: [] as string[],
    requiredName: 0,
    errors: [] as Error[],
    actions: 0,
  };
  const deps = {
    getToken: async () => null as string | null,
    storeToken: async (t: string) => {
      calls.stored.push(t);
    },
    getInstallationId: async () => "install-1",
    register: async (_id: string, _name: string) => ({ token: "tok-1" }),
    onRequireDisplayName: () => {
      calls.requiredName++;
    },
    onError: (e: Error) => {
      calls.errors.push(e);
    },
    ...overrides,
  };
  return { deps, calls };
}

test("registered: cloud action runs immediately", async () => {
  const { deps, calls } = fakeDeps({
    getToken: async () => "existing-token",
  });
  const session = createSession(deps);

  const result = await session.runCloudAction(async () => {
    calls.actions++;
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(calls.actions, 1);
  assert.equal(calls.requiredName, 0);
  assert.equal(session.state, "registered");
  assert.equal(session.isRegistered, true);
});

test("unregistered: cloud action is deferred and display name is required", async () => {
  const { deps, calls } = fakeDeps();
  const session = createSession(deps);

  const result = await session.runCloudAction(async () => {
    calls.actions++;
  });

  assert.equal(result, undefined);
  assert.equal(calls.actions, 0);
  assert.equal(calls.requiredName, 1);
  assert.equal(session.state, "awaitingName");
  assert.equal(session.isRegistered, false);
});

test("successful registration stores token and runs the deferred action", async () => {
  const { deps, calls } = fakeDeps();
  const session = createSession(deps);
  await session.runCloudAction(async () => {
    calls.actions++;
  });

  const ok = await session.submitDisplayName("Alice");

  assert.equal(ok, true);
  assert.deepEqual(calls.stored, ["tok-1"]);
  assert.equal(calls.actions, 1);
  assert.equal(session.state, "registered");
  assert.equal(session.isRegistered, true);
});

test("offline registration surfaces error, keeps pending action, stores no token", async () => {
  let offline = true;
  const { deps, calls } = fakeDeps({
    register: async (_id: string, _name: string) => {
      if (offline) throw new TypeError("fetch failed");
      return { token: "tok-2" };
    },
  });
  const session = createSession(deps);
  await session.runCloudAction(async () => {
    calls.actions++;
  });

  const ok = await session.submitDisplayName("Alice");

  assert.equal(ok, false);
  assert.equal(session.state, "error");
  assert.equal(session.isRegistered, false);
  assert.equal(session.error?.message, NEED_INTERNET_MESSAGE);
  assert.equal(calls.errors.length, 1);
  assert.equal(calls.actions, 0);
  assert.deepEqual(calls.stored, []);

  offline = false;
  const retried = await session.submitDisplayName("Alice");
  assert.equal(retried, true);
  assert.equal(calls.actions, 1);
  assert.deepEqual(calls.stored, ["tok-2"]);
  assert.equal(session.state, "registered");
});

test("local FS25 commands have no network or session dependency", () => {
  const source = readFileSync(new URL("./fs25.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\b|XMLHttpRequest|https?:\/\//);
  assert.doesNotMatch(source, /session|identity|API_BASE_URL|config/);
  assert.match(source, /invoke/);
});
