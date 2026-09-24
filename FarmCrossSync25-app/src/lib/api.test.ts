import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  createApiClient,
  UnauthorizedError,
} from "./api.ts";
import { API_BASE_URLS } from "./config.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const request = init ?? {};
    calls.push({ url: String(input), init: request });
    return respond(String(input), request);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test("attaches the session token to protected calls", async () => {
  const { fetchImpl, calls } = fakeFetch(() => json({ farm: { id: "f1" } }));
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => "tok-123",
    fetchImpl,
  });

  const body = await client.get<{ farm: { id: string } }>("/farms/f1");

  assert.equal(body.farm.id, "f1");
  assert.equal(calls[0].url, "https://api.test/farms/f1");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok-123");
});

test("omits the token on public calls and sends JSON", async () => {
  const { fetchImpl, calls } = fakeFetch(() => json({ token: "new" }));
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => "tok-123",
    fetchImpl,
  });

  await client.post(
    "/register",
    { installationId: "i1", displayName: "Ada" },
    { auth: false },
  );

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ installationId: "i1", displayName: "Ada" }));
});

test("a protected call with no token carries no Authorization header", async () => {
  const { fetchImpl, calls } = fakeFetch(() => json({}));
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => null,
    fetchImpl,
  });

  await client.get("/me");

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
});

test("resolves the base URL from the selected environment", async () => {
  const { fetchImpl, calls } = fakeFetch(() => json({}));
  const client = createApiClient({
    env: "staging",
    getToken: async () => "t",
    fetchImpl,
  });

  assert.equal(client.baseUrl, API_BASE_URLS.staging);
  await client.get("/me");
  assert.equal(calls[0].url, `${API_BASE_URLS.staging}/me`);

  const override = createApiClient({ baseUrl: "https://custom.example/", fetchImpl });
  assert.equal(override.baseUrl, "https://custom.example");
});

test("parses JSON bodies and returns undefined for empty responses", async () => {
  const { fetchImpl } = fakeFetch((_url, init) =>
    init.method === "DELETE"
      ? new Response(null, { status: 204 })
      : json({ user: { id: "u1", display_name: "Ada" } }),
  );
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => "t",
    fetchImpl,
  });

  const me = await client.get<{ user: { id: string } }>("/me");
  assert.equal(me.user.id, "u1");

  const empty = await client.request("/farms/f1/members/u2", { method: "DELETE" });
  assert.equal(empty, undefined);
});

test("throws ApiError with the status and server error code/message", async () => {
  const { fetchImpl } = fakeFetch(() => json({ error: "farm_full", max: 8 }, 409));
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => "t",
    fetchImpl,
  });

  await assert.rejects(
    () => client.post("/farms/f1/join", { code: "X" }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "farm_full");
      assert.equal(err.message, "farm_full");
      return true;
    },
  );
});

test("non-JSON error bodies fall back to a status message", async () => {
  const { fetchImpl } = fakeFetch(() => new Response("boom", { status: 500 }));
  const client = createApiClient({ baseUrl: "https://api.test", fetchImpl });

  await assert.rejects(
    () => client.get("/me"),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.code, null);
      return true;
    },
  );
});

test("a 401 throws UnauthorizedError and invokes the re-register hook", async () => {
  const { fetchImpl } = fakeFetch(() => json({ error: "unauthorized" }, 401));
  const seen: UnauthorizedError[] = [];
  const client = createApiClient({
    baseUrl: "https://api.test",
    getToken: async () => "stale",
    fetchImpl,
    onUnauthorized: (error) => {
      seen.push(error);
    },
  });

  await assert.rejects(
    () => client.get("/me"),
    (err: unknown) => {
      assert.ok(err instanceof UnauthorizedError);
      assert.equal(err.status, 401);
      assert.equal(err.code, "unauthorized");
      return true;
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 401);
});
