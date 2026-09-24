import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiError, UnauthorizedError } from "./api.ts";
import {
  createSession,
  httpRegister,
  NEED_INTERNET_MESSAGE,
} from "./session.ts";

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

test("a 401 mid-action re-queues the action and resumes it after re-registration", async () => {
  const { deps, calls } = fakeDeps({ getToken: async () => "stale-token" });
  const session = createSession(deps);
  let runs = 0;

  const result = await session.runCloudAction(async () => {
    runs += 1;
    if (runs === 1) throw new UnauthorizedError();
    return 42;
  });

  // The rejected token is dropped and the app is back at the registration
  // prompt; the interrupted action stays queued instead of failing.
  assert.equal(result, undefined);
  assert.equal(runs, 1);
  assert.equal(session.state, "awaitingName");
  assert.equal(session.isRegistered, false);
  assert.equal(calls.requiredName, 1);

  const ok = await session.submitDisplayName("Alice");
  assert.equal(ok, true);
  assert.equal(runs, 2, "the interrupted action resumed after re-registration");
  assert.equal(session.state, "registered");
  assert.deepEqual(calls.stored, ["tok-1"]);
});

test("handleUnauthorized drops the cached token and returns to the prompt", async () => {
  const { deps, calls } = fakeDeps({ getToken: async () => "stale-token" });
  const session = createSession(deps);
  await session.runCloudAction(async () => {
    calls.actions += 1;
  });
  assert.equal(calls.actions, 1, "the cached token ran the first action");

  session.handleUnauthorized();
  assert.equal(session.state, "awaitingName");
  assert.equal(calls.requiredName, 1, "back at the registration prompt");

  // The cached token is gone: the next action defers to the prompt instead of
  // running with the rejected token.
  const result = await session.runCloudAction(async () => {
    calls.actions += 1;
  });
  assert.equal(result, undefined);
  assert.equal(calls.actions, 1);
  assert.equal(calls.requiredName, 2);
  assert.equal(session.isRegistered, false);
});

function jsonFetch(
  body: unknown,
  status = 200,
  calls: Array<{ url: string; init: RequestInit }> = [],
): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

test("httpRegister registers through the shared client as a public call", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const register = httpRegister(
    "https://api.test",
    jsonFetch({ token: "tok-9" }, 200, calls),
  );

  const { token } = await register("install-1", "Ada");

  assert.equal(token, "tok-9");
  assert.equal(calls[0].url, "https://api.test/register");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
});

test("httpRegister surfaces ApiError with the status and server error string", async () => {
  const register = httpRegister(
    "https://api.test",
    jsonFetch({ error: "displayName is required" }, 400),
  );

  await assert.rejects(
    () => register("install-1", ""),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.equal(err.code, "displayName is required");
      assert.equal(err.message, "displayName is required");
      return true;
    },
  );
});

test("httpRegister invokes the recovery hook on a 401", async () => {
  const seen: UnauthorizedError[] = [];
  const register = httpRegister(
    "https://api.test",
    jsonFetch({ error: "unauthorized" }, 401),
    (error) => {
      seen.push(error);
    },
  );

  await assert.rejects(() => register("install-1", "Ada"), UnauthorizedError);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 401);
});
