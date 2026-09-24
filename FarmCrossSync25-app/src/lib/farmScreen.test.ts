import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, UnauthorizedError } from "./api.ts";
import {
  buildFarmView,
  createFarmScreen,
  httpFarmApi,
  type FarmDetail,
  type FarmScreenDeps,
  type Member,
  type PlayerSave,
} from "./farmScreen.ts";

const FARM: FarmDetail = { id: "f1", code: "X7K9-PQ2", name: "Green Acres" };

const MEMBERS: Member[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01T00:00:00Z" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02T00:00:00Z" },
  { user_id: "u3", display_name: "Cleo", role: "member", joined_at: "2026-01-03T00:00:00Z" },
];

const SAVES: PlayerSave[] = [
  {
    user_id: "u1",
    display_name: "Ada",
    save_name: "map1",
    file_size: 100,
    sha256: "aaa",
    uploaded_at: "2026-01-10T10:00:00Z",
    object_key: "k1",
  },
  {
    user_id: "u2",
    display_name: "Ben",
    save_name: "map2",
    file_size: 200,
    sha256: "bbb",
    uploaded_at: "2026-01-10T12:00:00Z",
    object_key: "k2",
  },
];

// Fake 20 s scheduler: records registrations/clears and fires ticks on demand.
function fakeScheduler() {
  const registered: Array<{ handler: () => void; ms: number }> = [];
  const cleared: unknown[] = [];
  let nextId = 0;
  return {
    scheduler: {
      setInterval(handler: () => void, ms: number) {
        registered.push({ handler, ms });
        return ++nextId;
      },
      clearInterval(id: unknown) {
        cleared.push(id);
      },
    },
    registered,
    cleared,
    tick() {
      for (const { handler } of [...registered]) handler();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("buildFarmView joins saves to members and picks the latest upload", () => {
  const view = buildFarmView(FARM, MEMBERS, SAVES);

  assert.equal(view.farm.code, "X7K9-PQ2");
  assert.equal(view.players.length, 3);

  const [ada, ben, cleo] = view.players;
  assert.equal(ada.lastUploadAt, "2026-01-10T10:00:00Z");
  assert.equal(ben.lastUploadAt, "2026-01-10T12:00:00Z");
  assert.equal(cleo.lastUploadAt, null, "member without a save shows never");
  assert.equal(cleo.save, null);
  assert.equal(ada.isOwner, true);
  assert.equal(ben.isOwner, false);

  assert.ok(view.latestUpload);
  assert.equal(view.latestUpload?.user_id, "u2");
  assert.equal(view.latestUpload?.uploaded_at, "2026-01-10T12:00:00Z");
});

test("copyCode invokes the injected clipboard with the farm code", async () => {
  const copied: string[] = [];
  const screen = createFarmScreen(
    makeDeps({ copyToClipboard: async (t) => { copied.push(t); } }),
    { scheduler: fakeScheduler().scheduler },
  );
  await screen.selectFarm("f1");
  assert.equal(await screen.copyCode(), true);
  assert.deepEqual(copied, ["X7K9-PQ2"]);
  screen.stop();
});

test("downloadSave forwards the save without needing a local save path", async () => {
  const calls: Array<{ farmId: string; playerId: string; save: PlayerSave }> = [];
  const screen = createFarmScreen(
    makeDeps({
      runDownload: async (input) => {
        calls.push(input);
        return { ok: true };
      },
    }),
    { scheduler: fakeScheduler().scheduler },
  );
  await screen.selectFarm("f1");
  const result = await screen.downloadSave("u2", SAVES[1]!);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.farmId, "f1");
  assert.equal(calls[0]!.playerId, "u2");
  assert.equal(calls[0]!.save.sha256, "bbb");
  screen.stop();
});

test("poll refresh updates the view model", async () => {
  const { scheduler, registered, tick } = fakeScheduler();
  let saves = SAVES;
  const screen = createFarmScreen(
    makeDeps({ fetchSaves: async () => saves }),
    { scheduler },
  );

  await screen.selectFarm("f1");
  assert.equal(screen.snapshot().players[2].lastUploadAt, null);
  assert.equal(registered[0].ms, 20_000);
  assert.equal(screen.snapshot().latestUpload?.user_id, "u2");

  // Cleo uploads; the next poll must pick it up, including the new latest.
  saves = [
    ...SAVES,
    {
      user_id: "u3",
      display_name: "Cleo",
      save_name: "map3",
      file_size: 300,
      sha256: "ccc",
      uploaded_at: "2026-01-10T14:00:00Z",
      object_key: "k3",
    },
  ];
  tick();
  await flush();

  const view = screen.snapshot();
  assert.equal(view.players[2].lastUploadAt, "2026-01-10T14:00:00Z");
  assert.equal(view.latestUpload?.user_id, "u3");
});

test("switching the active farm reloads state and restarts the poll", async () => {
  const { scheduler, registered, cleared, tick } = fakeScheduler();
  const requested: string[] = [];
  const farmB: FarmDetail = { id: "f2", code: "ZZZZ-111", name: "Other Farm" };
  const screen = createFarmScreen(
    makeDeps({
      fetchFarm: async (id) => {
        requested.push(id);
        return id === "f2" ? farmB : FARM;
      },
      fetchMembers: async (id) =>
        id === "f2"
          ? [{ user_id: "u9", display_name: "Zoe", role: "owner", joined_at: "2026-01-01T00:00:00Z" }]
          : MEMBERS,
      fetchSaves: async (id) =>
        id === "f2"
          ? []
          : SAVES,
    }),
    { scheduler },
  );

  await screen.selectFarm("f1");
  assert.equal(screen.snapshot().farm?.id, "f1");
  assert.equal(screen.snapshot().players.length, 3);
  assert.equal(registered.length, 1);

  await screen.selectFarm("f2");
  assert.deepEqual(requested, ["f1", "f2"]);
  assert.equal(screen.snapshot().farm?.id, "f2");
  assert.equal(screen.snapshot().farm?.name, "Other Farm");
  assert.equal(screen.snapshot().players.length, 1);
  assert.equal(screen.snapshot().latestUpload, null);
  assert.equal(cleared.length, 1, "old poll stopped");
  assert.equal(registered.length, 2, "poll restarted for the new farm");

  tick();
  await flush();
  assert.equal(requested.at(-1), "f2", "ticks poll the new farm");
});

function makeDeps(overrides: Partial<FarmScreenDeps> = {}): FarmScreenDeps {
  return {
    fetchFarm: async () => FARM,
    fetchMembers: async () => MEMBERS,
    fetchSaves: async () => SAVES,
    copyToClipboard: async () => {},
    runUpload: async () => ({ ok: true }),
    runDownload: async () => ({ ok: true }),
    ...overrides,
  };
}

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

test("httpFarmApi reads the envelope with the session token attached", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = httpFarmApi(
    "https://api.test",
    async () => "tok-1",
    jsonFetch({ saves: SAVES }, 200, calls),
  );

  const saves = await api.fetchSaves("f1");

  assert.deepEqual(saves, SAVES);
  assert.equal(calls[0].url, "https://api.test/farms/f1/saves");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok-1");
});

test("httpFarmApi surfaces ApiError with the HTTP status and server error string", async () => {
  const api = httpFarmApi(
    "https://api.test",
    async () => "tok-1",
    jsonFetch({ error: "farm not found" }, 404),
  );

  await assert.rejects(
    () => api.fetchFarm("nope"),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      assert.equal(err.code, "farm not found");
      assert.equal(err.message, "farm not found");
      return true;
    },
  );
});

test("httpFarmApi surfaces 401 as UnauthorizedError and invokes the recovery hook", async () => {
  const seen: UnauthorizedError[] = [];
  const api = httpFarmApi(
    "https://api.test",
    async () => "stale",
    jsonFetch({ error: "unauthorized" }, 401),
    (error) => {
      seen.push(error);
    },
  );

  await assert.rejects(() => api.fetchMembers("f1"), UnauthorizedError);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 401);
});
