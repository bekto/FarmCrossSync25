import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, UnauthorizedError } from "./api.ts";
import {
  createOwnerActions,
  httpOwnerApi,
  ownerRowActions,
  viewerIsOwner,
  kickConfirmation,
  transferConfirmation,
  type Invite,
  type OwnerActionDeps,
} from "./ownerActions.ts";

const FARM = { id: "f1", owner_id: "u1" };
const MEMBERS = [
  { user_id: "u1", role: "owner" },
  { user_id: "u2", role: "member" },
  { user_id: "u3", role: "member" },
];

const INVITES: Invite[] = [
  { id: "i1", user_id: "u9", display_name: "Zoe", created_at: "2026-02-01T09:00:00Z" },
  { id: "i2", user_id: "u8", display_name: "Max", created_at: "2026-02-01T10:00:00Z" },
];

interface Recorded {
  calls: string[];
  confirms: string[];
  confirmsWith: boolean;
  invites: Invite[];
  errors: number;
}

function makeDeps(record: Recorded, overrides: Partial<OwnerActionDeps> = {}): OwnerActionDeps {
  return {
    fetchInvites: async (farmId) => {
      record.calls.push(`fetchInvites:${farmId}`);
      return record.invites;
    },
    acceptInvite: async (id) => {
      record.calls.push(`accept:${id}`);
    },
    denyInvite: async (id) => {
      record.calls.push(`deny:${id}`);
    },
    transferOwner: async (farmId, userId) => {
      record.calls.push(`transfer:${farmId}:${userId}`);
    },
    kickMember: async (farmId, userId) => {
      record.calls.push(`kick:${farmId}:${userId}`);
    },
    confirm: (message) => {
      record.confirms.push(message);
      return record.confirmsWith;
    },
    ...overrides,
  };
}

function record(): Recorded {
  return { calls: [], confirms: [], confirmsWith: true, invites: INVITES, errors: 0 };
}

// --- Criterion 4: ownership resolution ------------------------------------

test("viewerIsOwner reads the member role, falls back to farm owner_id", () => {
  assert.equal(viewerIsOwner(FARM, MEMBERS, "u1"), true, "owner role");
  assert.equal(viewerIsOwner(FARM, MEMBERS, "u2"), false, "member role");
  assert.equal(viewerIsOwner(FARM, MEMBERS, null), false, "unknown viewer");
  assert.equal(viewerIsOwner({ id: "f1" }, [], "u1"), false, "not a member");
  assert.equal(viewerIsOwner(FARM, [], "u1"), true, "fallback to farm owner_id");
});

test("ownerRowActions: owner manages others only; non-owner manages none", () => {
  assert.deepEqual(ownerRowActions("u2", true, "u1"), {
    canMakeOwner: true,
    canKick: true,
  });
  assert.deepEqual(ownerRowActions("u1", true, "u1"), {
    canMakeOwner: false,
    canKick: false,
  }, "owner does not manage themselves");
  assert.deepEqual(ownerRowActions("u2", false, "u3"), {
    canMakeOwner: false,
    canKick: false,
  }, "non-owner sees no owner actions");
  assert.deepEqual(ownerRowActions("u2", true, null), {
    canMakeOwner: false,
    canKick: false,
  }, "unresolved viewer sees no owner actions");
});

// --- Criterion 1: owner sees pending join requests -------------------------

test("owner loads pending invites with display name and requested time", async () => {
  const r = record();
  const owner = createOwnerActions(makeDeps(r));
  await owner.loadInvites("f1", true);

  const state = owner.snapshot();
  assert.deepEqual(r.calls, ["fetchInvites:f1"]);
  assert.equal(state.invites.length, 2);
  assert.equal(state.invites[0].display_name, "Zoe");
  assert.equal(state.invites[0].created_at, "2026-02-01T09:00:00Z");
  assert.equal(state.loadingInvites, false);
  assert.equal(state.error, null);
});

test("accept and deny call the endpoint then refresh the list", async () => {
  const r = record();
  const owner = createOwnerActions(makeDeps(r));

  await owner.accept("f1", "i1");
  assert.deepEqual(r.calls, ["accept:i1", "fetchInvites:f1"]);

  await owner.deny("f1", "i2");
  assert.deepEqual(r.calls, ["accept:i1", "fetchInvites:f1", "deny:i2", "fetchInvites:f1"]);
});

// --- Criterion 3: transfer and kick require confirmation -------------------

test("makeOwner proceeds only after confirmation", async () => {
  const r = record();
  r.confirmsWith = true;
  const owner = createOwnerActions(makeDeps(r));

  const ok = await owner.makeOwner("f1", "u2", "Ben");
  assert.equal(ok, true);
  assert.equal(r.confirms.length, 1);
  assert.equal(r.confirms[0], transferConfirmation("Ben"));
  assert.ok(r.confirms[0].includes("Ben"));
  assert.deepEqual(r.calls, ["transfer:f1:u2"]);
});

test("makeOwner is skipped when the confirmation is declined", async () => {
  const r = record();
  r.confirmsWith = false;
  const owner = createOwnerActions(makeDeps(r));

  const ok = await owner.makeOwner("f1", "u2", "Ben");
  assert.equal(ok, false);
  assert.equal(r.confirms.length, 1, "dialog was shown");
  assert.deepEqual(r.calls, [], "no backend call after declining");
});

test("kick proceeds only after confirmation", async () => {
  const r = record();
  r.confirmsWith = true;
  const owner = createOwnerActions(makeDeps(r));

  const ok = await owner.kick("f1", "u3", "Cleo");
  assert.equal(ok, true);
  assert.equal(r.confirms[0], kickConfirmation("Cleo"));
  assert.deepEqual(r.calls, ["kick:f1:u3"]);
});

test("kick is skipped when the confirmation is declined", async () => {
  const r = record();
  r.confirmsWith = false;
  const owner = createOwnerActions(makeDeps(r));

  const ok = await owner.kick("f1", "u3", "Cleo");
  assert.equal(ok, false);
  assert.equal(r.confirms.length, 1, "dialog was shown");
  assert.deepEqual(r.calls, [], "no backend call after declining");
});

// --- Criterion 4: non-owners never touch owner-only deps -------------------

test("non-owner loads no invites and cannot act", async () => {
  const r = record();
  const owner = createOwnerActions(makeDeps(r));

  await owner.loadInvites("f1", false);
  assert.deepEqual(r.calls, [], "fetchInvites not called for a non-owner");
  assert.deepEqual(owner.snapshot().invites, []);
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

test("httpOwnerApi attaches the session token and unwraps the envelope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = httpOwnerApi(
    "https://api.test",
    async () => "tok-1",
    jsonFetch({ invites: INVITES }, 200, calls),
  );

  const invites = await api.fetchInvites("f1");

  assert.deepEqual(invites, INVITES);
  assert.equal(calls[0].url, "https://api.test/farms/f1/invites");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok-1");
});

test("httpOwnerApi surfaces ApiError with the HTTP status and server error string", async () => {
  const api = httpOwnerApi(
    "https://api.test",
    async () => "tok-1",
    jsonFetch({ error: "invite_not_pending" }, 409),
  );

  await assert.rejects(
    () => api.denyInvite("i1"),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "invite_not_pending");
      assert.equal(err.message, "invite_not_pending");
      return true;
    },
  );
});

test("httpOwnerApi surfaces 401 as UnauthorizedError and invokes the recovery hook", async () => {
  const seen: UnauthorizedError[] = [];
  const api = httpOwnerApi(
    "https://api.test",
    async () => "stale",
    jsonFetch({ error: "unauthorized" }, 401),
    (error) => {
      seen.push(error);
    },
  );

  await assert.rejects(() => api.fetchCurrentUserId(), UnauthorizedError);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 401);
});
