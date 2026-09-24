import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICT_CANCELLED_MESSAGE,
  CONFLICT_MESSAGE,
  detectConflict,
  resolveConflict,
  runDownloadWithConflict,
  type ConflictChoice,
} from "./conflict.ts";
import type { DownloadDeps } from "./download.ts";
import type { SyncState } from "./fs25.ts";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const NOW = "2026-09-22T10:00:00.000Z";

const INPUT = {
  farmId: "f1",
  playerId: "p2",
  fs25Root: "/saves",
  slot: 1,
  slotPath: "/saves/savegame1",
  slotUsed: true,
  expectedSha256: HASH,
  apiBaseUrl: "https://api.example",
  backupDir: "/configured-backups",
};

function makeDeps(overrides: Partial<DownloadDeps> = {}) {
  const calls: string[] = [];
  const deps: DownloadDeps = {
    readMetadata: async () => {
      calls.push("metadata");
      return {
        slot: 1,
        mapName: "Riverbend Springs",
        path: "/saves/savegame1",
        lastModified: NOW,
        sizeBytes: 10,
        contentHash: HASH,
      };
    },
    computeHash: async () => {
      calls.push("hash");
      return { path: "/tmp/staged", hash: HASH };
    },
    downloadAuthorize: async () => {
      calls.push("authorize");
      return {
        objectKey: "farms/f1/players/p2/save",
        url: "https://r2.example/save",
        method: "GET",
        headers: {},
        expiresAt: NOW,
      };
    },
    fetchArchive: async () => {
      calls.push("fetch");
      return { archivePath: "/tmp/download.zip" };
    },
    unpackSave: async () => {
      calls.push("unpack");
      return { destPath: "/tmp/staged", fileCount: 3 };
    },
    installSaveToSlot: async () => {
      calls.push("install");
      return {
        path: "/saves/savegame1",
        contentHash: HASH,
        backupPath: "/configured-backups/savegame1_backup",
        wasEmpty: false,
      };
    },
    setFarmSlot: async () => {
      calls.push("setSlot");
      return {} as SyncState;
    },
    readSyncState: async () => {
      calls.push("readSync");
      return null;
    },
    writeSyncState: async (_farmId, state) => {
      calls.push("writeSync");
      return state;
    },
    cleanupPack: async () => {
      calls.push("cleanupArchive");
    },
    cleanupUnpack: async () => {
      calls.push("cleanupStaging");
    },
    ...overrides,
  };
  return { deps, calls };
}

test("no conflict when local and last-synced hashes match", () => {
  assert.equal(detectConflict({ localHash: HASH, lastSyncedHash: HASH }), false);
});

test("hash comparison is case-insensitive", () => {
  assert.equal(detectConflict({ localHash: HASH.toUpperCase(), lastSyncedHash: HASH }), false);
});

test("conflict when local hash differs from last-synced hash", () => {
  assert.equal(detectConflict({ localHash: OTHER, lastSyncedHash: HASH }), true);
});

test("first sync (null last-synced hash) is never a conflict", () => {
  assert.equal(detectConflict({ localHash: HASH, lastSyncedHash: null }), false);
  assert.equal(detectConflict({ localHash: null, lastSyncedHash: null }), false);
});

test("unknown local hash with a prior sync is treated as a conflict (safest)", () => {
  assert.equal(detectConflict({ localHash: null, lastSyncedHash: HASH }), true);
});

test("resolveConflict proceeds without invoking the dialog when hashes match", async () => {
  let dialogCalls = 0;
  const decision = await resolveConflict({
    localHash: HASH,
    lastSyncedHash: HASH,
    choose: () => {
      dialogCalls += 1;
      return "keep";
    },
  });
  assert.equal(decision, "download");
  assert.equal(dialogCalls, 0, "dialog must not appear without a conflict");
});

test("resolveConflict invokes the dialog exactly once on conflict and returns its choice", async () => {
  const seen: string[] = [];
  const decision = await resolveConflict({
    localHash: OTHER,
    lastSyncedHash: HASH,
    choose: (message) => {
      seen.push(message);
      return "keep";
    },
  });
  assert.equal(decision, "keep");
  assert.deepEqual(seen, [CONFLICT_MESSAGE]);
});

test("resolveConflict returns download / cancel choices verbatim", async () => {
  for (const choice of ["download", "cancel"] as ConflictChoice[]) {
    const decision = await resolveConflict({
      localHash: OTHER,
      lastSyncedHash: HASH,
      choose: () => choice,
    });
    assert.equal(decision, choice);
  }
});

test("conflict + Keep My Save aborts before any backup/fetch/replace", async () => {
  const { deps, calls } = makeDeps();
  let dialogCalls = 0;

  const result = await runDownloadWithConflict(INPUT, deps, {}, {
    localHash: OTHER,
    lastSyncedHash: HASH,
    choose: () => {
      dialogCalls += 1;
      return "keep";
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "cancelled");
  assert.ok(result.message.includes(CONFLICT_CANCELLED_MESSAGE));
  assert.equal(dialogCalls, 1);
  assert.deepEqual(calls, [], "local data untouched: no dep was called");
});

test("conflict + Cancel does nothing (dialog closes, no changes)", async () => {
  const { deps, calls } = makeDeps();

  const result = await runDownloadWithConflict(INPUT, deps, {}, {
    localHash: OTHER,
    lastSyncedHash: HASH,
    choose: () => "cancel",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "cancelled");
  assert.deepEqual(calls, []);
});

test("conflict + Download Cloud Save proceeds into the normal flow", async () => {
  const { deps, calls } = makeDeps();

  const result = await runDownloadWithConflict(INPUT, deps, { confirm: () => true }, {
    localHash: OTHER,
    lastSyncedHash: HASH,
    choose: () => "download",
  });

  assert.equal(result.ok, true);
  assert.ok(calls.includes("fetch"));
  assert.ok(calls.includes("install"), "the replacement runs (and creates its backup)");
  assert.ok(calls.includes("writeSync"));
});

test("no conflict skips the dialog and downloads", async () => {
  const { deps, calls } = makeDeps();
  let dialogCalls = 0;

  const result = await runDownloadWithConflict(INPUT, deps, { confirm: () => true }, {
    localHash: HASH,
    lastSyncedHash: HASH,
    choose: () => {
      dialogCalls += 1;
      return "keep";
    },
  });

  assert.equal(result.ok, true);
  assert.equal(dialogCalls, 0);
  assert.ok(calls.includes("install"));
});

// --- Ticket 72: the production gate wiring (metadata.contentHash as localHash)

test("an unchanged save after a successful sync produces no conflict", async () => {
  // Mirrors +page.svelte: localHash comes from `readMetadata().contentHash`,
  // lastSyncedHash from the persisted sync state written by the sync.
  const metadata = {
    slot: 1,
    mapName: "Riverbend Springs",
    path: "/saves/savegame1",
    lastModified: NOW,
    sizeBytes: 10,
    contentHash: HASH as string | null,
  };
  const state = { lastSyncedHash: HASH as string | null };
  const { deps, calls } = makeDeps();
  let dialogCalls = 0;

  const result = await runDownloadWithConflict(INPUT, deps, { confirm: () => true }, {
    localHash: metadata.contentHash,
    lastSyncedHash: state.lastSyncedHash,
    choose: () => {
      dialogCalls += 1;
      return "keep";
    },
  });

  assert.equal(result.ok, true);
  assert.equal(dialogCalls, 0, "unchanged save must not raise the conflict warning");
  assert.ok(calls.includes("install"), "download proceeds");
});

test("a changed save warns before a cloud download replaces it", async () => {
  const metadata = {
    slot: 1,
    mapName: "Riverbend Springs",
    path: "/saves/savegame1",
    lastModified: NOW,
    sizeBytes: 10,
    contentHash: OTHER as string | null,
  };
  const state = { lastSyncedHash: HASH as string | null };
  const { deps, calls } = makeDeps();
  const seen: string[] = [];

  const result = await runDownloadWithConflict(INPUT, deps, { confirm: () => true }, {
    localHash: metadata.contentHash,
    lastSyncedHash: state.lastSyncedHash,
    choose: (message) => {
      seen.push(message);
      return "keep";
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(seen, [CONFLICT_MESSAGE], "the conflict warning comes first");
  assert.deepEqual(calls, [], "nothing runs before the user decides");
  if (!result.ok) {
    assert.ok(result.message.includes(CONFLICT_CANCELLED_MESSAGE));
  }
});
