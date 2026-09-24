import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, UnauthorizedError } from "./api.ts";
import {
  createFarmSetup,
  httpFarmSetupApi,
  type FarmSetupApi,
  type FarmSetupDeps,
} from "./farmSetup.ts";

const BIND_FAILURE_MESSAGE =
  "Farm created, but the slot could not be linked (no slot). Choose it on the Farm screen.";
const JOIN_BIND_FAILURE_MESSAGE =
  "Request sent. The slot could not be linked (no slot). Choose your slot on the Farm screen once accepted.";

function setup(overrides: Partial<FarmSetupDeps> = {}) {
  const calls: string[] = [];
  const api: FarmSetupApi = {
    listFarms: async () => [],
    createFarm: async (name) => ({ id: "farm-1", name }),
    joinFarm: async () => ({ farmId: "farm-1" }),
  };
  const deps: FarmSetupDeps = {
    api,
    setFarms: () => {},
    setActiveFarm: (id) => calls.push(`active:${id}`),
    bindSlot: async (id, slot) => {
      calls.push(`bind:${id}:${slot}`);
    },
    ...overrides,
  };
  return { screen: createFarmSetup(deps), calls };
}

test("create rejects a missing slot without calling the API", async () => {
  let created = false;
  const { screen } = setup({
    api: {
      listFarms: async () => [],
      createFarm: async (name) => {
        created = true;
        return { id: "farm-1", name };
      },
      joinFarm: async () => ({ farmId: "farm-1" }),
    },
  });

  const ok = await screen.create("My Farm", undefined as unknown as number);

  assert.equal(ok, false);
  assert.equal(created, false);
  assert.equal(screen.snapshot().error, "Pick the save slot to start this farm with.");
});

test("create binds the slot before activating the farm", async () => {
  const { screen, calls } = setup();

  const ok = await screen.create("My Farm", 3);

  assert.equal(ok, true);
  assert.deepEqual(calls, ["bind:farm-1:3", "active:farm-1"]);
  assert.equal(screen.snapshot().error, null);
});

test("create still activates the farm when bindSlot fails", async () => {
  const { screen, calls } = setup({
    bindSlot: async () => {
      throw new Error("no slot");
    },
  });

  const ok = await screen.create("My Farm", 3);

  assert.equal(ok, true);
  assert.deepEqual(calls, ["active:farm-1"]);
  assert.equal(screen.snapshot().error, BIND_FAILURE_MESSAGE);
});

test("join rejects a missing slot without calling the API", async () => {
  let joined = false;
  const { screen } = setup({
    api: {
      listFarms: async () => [],
      createFarm: async (name) => ({ id: "farm-1", name }),
      joinFarm: async () => {
        joined = true;
        return { farmId: "farm-1" };
      },
    },
  });

  const ok = await screen.join("X7K9-PQ2", undefined as unknown as number);

  assert.equal(ok, false);
  assert.equal(joined, false);
  assert.equal(screen.snapshot().error, "Pick the save slot to link to this farm.");
});

test("join binds the farm id returned by the lookup", async () => {
  const { screen, calls } = setup();

  const ok = await screen.join("X7K9-PQ2", 5);

  assert.equal(ok, true);
  assert.deepEqual(calls, ["bind:farm-1:5"]);
  assert.equal(screen.snapshot().error, null);
  assert.equal(
    screen.snapshot().message,
    "Request sent. The farm owner must accept it before the farm appears.",
  );
});

test("join does not bind anything when the request fails", async () => {
  const { screen, calls } = setup({
    api: {
      listFarms: async () => [],
      createFarm: async (name) => ({ id: "farm-1", name }),
      joinFarm: async () => {
        throw new Error("farm-not-found");
      },
    },
  });

  const ok = await screen.join("BAD-CODE", 5);

  assert.equal(ok, false);
  assert.deepEqual(calls, []);
  assert.equal(screen.snapshot().message, null);
});

test("join still succeeds when bindSlot fails", async () => {
  const { screen, calls } = setup({
    bindSlot: async () => {
      throw new Error("no slot");
    },
  });

  const ok = await screen.join("X7K9-PQ2", 5);

  assert.equal(ok, true);
  assert.deepEqual(calls, []);
  assert.equal(screen.snapshot().error, null);
  assert.equal(screen.snapshot().message, JOIN_BIND_FAILURE_MESSAGE);
});

test("create surfaces a slot owned by another farm clearly", async () => {
  const { screen } = setup({
    bindSlot: async () => {
      throw { kind: "slotConflict", slot: 3, ownerFarmId: "farm-2" };
    },
  });

  const ok = await screen.create("My Farm", 3);

  assert.equal(ok, true, "the farm is still created");
  assert.equal(
    screen.snapshot().error,
    "Farm created, but the slot could not be linked (Slot 3 is already linked to another farm; choose a different slot). Choose it on the Farm screen.",
  );
});

// --- Production data access through the shared client (ticket 76) ----------

function jsonFetch(
  body: unknown,
  status: number,
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

test("httpFarmSetupApi resolves the farm id through lookup, then joins with the token", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = String(url).includes("/farms/lookup")
      ? { farm: { id: "f9" } }
      : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const api = httpFarmSetupApi("https://api.test", async () => "tok-1", fetchImpl);

  const { farmId } = await api.joinFarm("CODE-1");

  assert.equal(farmId, "f9");
  assert.equal(calls[0].url, "https://api.test/farms/lookup?code=CODE-1");
  assert.equal(calls[1].url, "https://api.test/farms/f9/join");
  assert.equal(calls[1].init.method, "POST");
  const headers = calls[1].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok-1");
});

test("httpFarmSetupApi surfaces ApiError with the HTTP status and server error string", async () => {
  const api = httpFarmSetupApi(
    "https://api.test",
    async () => "tok-1",
    jsonFetch({ error: "farm not found" }, 404),
  );

  await assert.rejects(
    () => api.joinFarm("NOPE"),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      assert.equal(err.code, "farm not found");
      assert.equal(err.message, "farm not found");
      return true;
    },
  );
});

test("httpFarmSetupApi surfaces 401 as UnauthorizedError and invokes the recovery hook", async () => {
  const seen: UnauthorizedError[] = [];
  const api = httpFarmSetupApi(
    "https://api.test",
    async () => "stale",
    jsonFetch({ error: "unauthorized" }, 401),
    (error) => {
      seen.push(error);
    },
  );

  await assert.rejects(() => api.listFarms(), UnauthorizedError);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 401);
});
