import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_CONFIRMATION_MESSAGE,
  DOWNLOAD_TO_EMPTY_SLOT_MESSAGE,
  INSTALLED_NOT_RECORDED_MESSAGE,
  ORIGINAL_SAVE_RECOVERABLE_MESSAGE,
  runDownload,
  VERIFICATION_FAILED_MESSAGE,
  type DownloadDeps,
  type DownloadPhase,
} from "./download.ts";
import type { SyncState } from "./fs25.ts";

const HASH = "a".repeat(64);
const EXPECTED = HASH;
const NOW = "2026-09-22T10:00:00.000Z";

const INPUT = {
  farmId: "f1",
  playerId: "p2",
  fs25Root: "/saves",
  slot: 1,
  slotPath: "/saves/savegame1",
  slotUsed: true,
  expectedSha256: EXPECTED,
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
        contentHash: "old-local-hash",
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
        url: "https://r2.example/farms/f1/players/p2/save",
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

function confirmSpy(calls: string[], result: boolean) {
  return (message: string) => {
    calls.push("confirm");
    assert.equal(
      message,
      DOWNLOAD_CONFIRMATION_MESSAGE,
      "confirmation copy must state a backup is created first",
    );
    return result;
  };
}

test("happy path confirms, fetches, verifies, replaces (one backup), then writes sync state", async () => {
  const { deps, calls } = makeDeps();
  const phases: DownloadPhase[] = [];

  const result = await runDownload(INPUT, deps, {
    onPhase: (phase) => phases.push(phase),
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "complete");
  if (result.outcome !== "complete") return;
  assert.equal(result.sha256, HASH);
  assert.equal(result.backupPath, "/configured-backups/savegame1_backup");
  assert.equal(result.state.slot, 1, "sync state records the target slot");
  assert.equal(result.state.boundSavePath, "/saves/savegame1");

  const flow = calls.filter(
    (c) => c !== "readSync" && c !== "cleanupArchive" && c !== "cleanupStaging",
  );
  assert.deepEqual(flow, [
    "confirm",
    "metadata",
    "authorize",
    "fetch",
    "unpack",
    "hash",
    "install",
    "setSlot",
    "writeSync",
  ]);
  assert.ok(calls.indexOf("hash") < calls.indexOf("install"));
  assert.ok(calls.indexOf("install") < calls.indexOf("setSlot"));
  assert.ok(calls.indexOf("setSlot") < calls.indexOf("writeSync"));
  assert.ok(calls.includes("cleanupArchive"), "temp archive cleaned up on success");
  assert.ok(calls.includes("cleanupStaging"), "staging cleaned up on success");
  assert.deepEqual(phases, [
    "confirming",
    "downloading",
    "unpacking",
    "verifying",
    "replacing",
  ]);
});

test("confirmation is required; declining aborts before any change", async () => {
  const { deps, calls } = makeDeps();

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, false),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "cancelled");
  assert.ok(result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(calls.includes("confirm"), "confirmation step ran");
  assert.ok(!calls.includes("fetch"));
  assert.ok(!calls.includes("install"));
  assert.ok(!calls.includes("setSlot"));
  assert.ok(!calls.includes("writeSync"));
});

test("hash mismatch aborts before install with a verification-failed message", async () => {
  const { deps, calls } = makeDeps({
    computeHash: async () => {
      calls.push("hash");
      return { path: "/tmp/staged", hash: "b".repeat(64) };
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "verification");
  assert.ok(result.message.includes(VERIFICATION_FAILED_MESSAGE));
  assert.ok(result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(!calls.includes("install"), "install must not run on mismatch");
  assert.ok(!calls.includes("setSlot"), "slot binding must not run on mismatch");
  assert.ok(!calls.includes("writeSync"), "sync state must not be written on mismatch");
  assert.ok(calls.includes("cleanupArchive"), "archive cleaned up on mismatch");
  assert.ok(calls.includes("cleanupStaging"), "staging cleaned up on mismatch");
});

test("mid-flow fetch failure leaves the original recoverable and reports it", async () => {
  const { deps, calls } = makeDeps({
    fetchArchive: async () => {
      calls.push("fetch-failed");
      throw new Error("network down");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "error");
  assert.ok(result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(result.message.includes("network down"));
  assert.ok(!calls.includes("unpack"));
  assert.ok(!calls.includes("install"));
  assert.ok(!calls.includes("setSlot"));
  assert.ok(!calls.includes("writeSync"), "sync state is not written on failure");
});

test("install failure reports the original recoverable and writes no state", async () => {
  const { deps, calls } = makeDeps({
    installSaveToSlot: async () => {
      calls.push("install-failed");
      throw new Error("swap failed");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "error");
  assert.ok(result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(!calls.includes("setSlot"));
  assert.ok(!calls.includes("writeSync"));
  assert.ok(calls.includes("cleanupArchive"));
  assert.ok(calls.includes("cleanupStaging"));
});

// --- Ticket 75: recovery when install succeeds but bookkeeping fails --------

test("binding failure after install reports partial success, never the unchanged-original copy", async () => {
  const { deps, calls } = makeDeps({
    setFarmSlot: async () => {
      calls.push("setSlot-failed");
      throw new Error("bind failed");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, true, "the install succeeded: this is not a failure");
  if (!result.ok) return;
  assert.equal(result.outcome, "partial");
  if (result.outcome !== "partial") return;
  assert.equal(result.state, null, "nothing was persisted");
  assert.ok(result.message.includes("installed to Slot 1"), "copy states the save was installed");
  assert.ok(result.message.includes("bind failed"), "copy carries the real cause");
  assert.ok(
    !result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE),
    "must never claim the original save is unchanged once it was replaced",
  );
  assert.ok(calls.includes("install"), "install ran before the binding failed");
  assert.equal(
    calls.filter((c) => c === "setSlot-failed").length,
    2,
    "the binding is retried once to reconcile",
  );
  assert.ok(!calls.includes("writeSync"), "no state write after the binding failed");
  assert.equal(result.backupPath, "/configured-backups/savegame1_backup");
});

test("state-write failure after install reports partial success with accurate copy", async () => {
  const { deps, calls } = makeDeps({
    writeSyncState: async () => {
      calls.push("writeSync-failed");
      throw new Error("disk full");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "partial");
  if (result.outcome !== "partial") return;
  assert.equal(result.state, null);
  assert.ok(result.message.includes("installed to Slot 1"));
  assert.ok(result.message.includes("disk full"));
  assert.ok(!result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.equal(
    calls.filter((c) => c === "writeSync-failed").length,
    2,
    "the state write is retried once to reconcile",
  );
});

test("a transient bookkeeping failure is reconciled by the retry", async () => {
  let attempts = 0;
  const { deps, calls } = makeDeps({
    setFarmSlot: async () => {
      attempts += 1;
      if (attempts === 1) {
        calls.push("setSlot-failed");
        throw new Error("transient");
      }
      calls.push("setSlot");
      return {} as SyncState;
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "complete", "the retry reconciled the install");
  if (result.outcome !== "complete") return;
  assert.equal(result.state.localHash, HASH);
  assert.ok(calls.includes("writeSync"));
});

test("a pre-install failure keeps the unchanged-original copy and leaves state untouched", async () => {
  const previous: SyncState = {
    farmId: "f1",
    localHash: "old",
    lastUploadedHash: "up",
    lastUploadedAt: "2020-01-01T00:00:00.000Z",
    lastDownloadedHash: "dl",
    lastDownloadedAt: "2020-01-02T00:00:00.000Z",
    boundSavePath: "/saves/savegame1",
    slot: 1,
    lastSyncedHash: "baseline",
    lastSyncedAt: "2020-01-03T00:00:00.000Z",
    updatedAt: "2020-01-04T00:00:00.000Z",
  };
  let stored: SyncState | null = previous;
  const before = JSON.stringify(previous);
  const { deps, calls } = makeDeps({
    readSyncState: async () => stored,
    writeSyncState: async (_farmId, state) => {
      stored = state;
      return state;
    },
    unpackSave: async () => {
      calls.push("unpack-failed");
      throw new Error("corrupt archive");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "error");
  assert.ok(result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(result.message.includes("corrupt archive"));
  assert.ok(!calls.includes("install"), "nothing was replaced");
  assert.ok(!calls.includes("setSlot"));
  assert.ok(!calls.includes("writeSync"));
  assert.equal(JSON.stringify(stored), before, "state untouched");
});

// --- Ticket 87: exactly one backup, from the authoritative replacement ------

test("a used-slot download creates exactly one backup under the configured dir", async () => {
  const backups: string[] = [];
  let installArgs: {
    root: string;
    slot: number;
    stagedPath: string;
    expectedHash?: string | null;
    backupDir?: string | null;
  } | null = null;
  const { deps, calls } = makeDeps({
    installSaveToSlot: async (root, slot, stagedPath, expectedHash, backupDir) => {
      calls.push("install");
      installArgs = { root, slot, stagedPath, expectedHash, backupDir };
      // The Rust replacement creates the single backup under backupDir.
      const backupPath = `${backupDir}/savegame${slot}_backup`;
      backups.push(backupPath);
      return {
        path: `/saves/savegame${slot}`,
        contentHash: HASH,
        backupPath,
        wasEmpty: false,
      };
    },
  });

  const result = await runDownload(
    { ...INPUT, backupDir: "/my/backups" },
    deps,
    { confirm: confirmSpy(calls, true) },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(installArgs, {
    root: "/saves",
    slot: 1,
    stagedPath: "/tmp/staged",
    expectedHash: HASH,
    backupDir: "/my/backups",
  });
  assert.deepEqual(backups, ["/my/backups/savegame1_backup"], "exactly one backup");
  assert.equal(
    result.backupPath,
    "/my/backups/savegame1_backup",
    "DownloadSuccess.backupPath reports the backup the replacement created",
  );
});

test("an empty-slot download creates no backup", async () => {
  const backups: string[] = [];
  const { deps, calls } = makeDeps({
    installSaveToSlot: async (_root, _slot, _staged, _expected, _backupDir) => {
      calls.push("install");
      return {
        path: "/saves/savegame1",
        contentHash: HASH,
        backupPath: null,
        wasEmpty: true,
      };
    },
  });

  const result = await runDownload(
    { ...INPUT, slotUsed: false },
    deps,
    { confirm: () => true },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(backups, [], "nothing to back up in an empty slot");
  assert.equal(result.backupPath, null);
  assert.ok(!calls.includes("metadata"), "no preflight for an empty slot");
});

test("a bound-but-empty slot installs through the empty path without touching local content", async () => {
  // Regression (ticket 74): the farm is bound to the slot but no folder
  // exists. Used-vs-empty comes from folder existence, so the flow must not
  // read, confirm replacement of, or back up nonexistent content.
  let installArgs:
    | { root: string; slot: number; stagedPath: string; expectedHash?: string | null }
    | null = null;
  const { deps, calls } = makeDeps({
    readMetadata: async () => {
      calls.push("metadata");
      throw new Error("savegame1 does not exist");
    },
    installSaveToSlot: async (root, slot, stagedPath, expectedHash) => {
      calls.push("install");
      installArgs = { root, slot, stagedPath, expectedHash };
      return {
        path: "/saves/savegame1",
        contentHash: HASH,
        backupPath: null,
        wasEmpty: true,
      };
    },
  });

  const result = await runDownload(
    { ...INPUT, slotUsed: false },
    deps,
    {
      confirm: (message) => {
        calls.push("confirm");
        assert.equal(
          message,
          DOWNLOAD_TO_EMPTY_SLOT_MESSAGE(1),
          "no replacement confirmation for nonexistent content",
        );
        return true;
      },
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!calls.includes("metadata"), "nonexistent local content is never read");
  assert.ok(calls.includes("install"), "the install creates the selected slot");
  assert.equal(result.backupPath, null, "no backup for nonexistent content");
  if (result.outcome !== "complete") return;
  assert.equal(result.state.boundSavePath, "/saves/savegame1");
  assert.deepEqual(installArgs, {
    root: "/saves",
    slot: 1,
    stagedPath: "/tmp/staged",
    expectedHash: HASH,
  });
});

test("empty slot installs, binds the slot, and reports no backup", async () => {
  const { deps, calls } = makeDeps({
    installSaveToSlot: async () => {
      calls.push("install");
      return {
        path: "/saves/savegame1",
        contentHash: HASH,
        backupPath: null,
        wasEmpty: true,
      };
    },
  });

  const result = await runDownload(
    { ...INPUT, slotUsed: false },
    deps,
    {
      confirm: (message) => {
        calls.push("confirm");
        assert.equal(message, DOWNLOAD_TO_EMPTY_SLOT_MESSAGE(1));
        return true;
      },
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!calls.includes("metadata"), "no preflight readMetadata for empty slot");
  assert.ok(calls.includes("install"));
  assert.ok(calls.includes("setSlot"));
  assert.ok(calls.includes("writeSync"));
  assert.equal(result.backupPath, null, "empty slot has no backup path");
  if (result.outcome !== "complete") return;
  assert.equal(result.state.slot, 1);
  assert.equal(result.state.boundSavePath, "/saves/savegame1");
  assert.ok(calls.includes("cleanupArchive"));
  assert.ok(calls.includes("cleanupStaging"));
});

test("success writes and returns the new sync state, preserving other fields", async () => {
  let written: SyncState | null = null;
  const { deps } = makeDeps({
    readSyncState: async () => ({
      farmId: "f1",
      localHash: "old",
      lastUploadedHash: "up",
      lastUploadedAt: "2020-01-01T00:00:00.000Z",
      lastDownloadedHash: "olddl",
      lastDownloadedAt: "2020-01-01T00:00:00.000Z",
      boundSavePath: "/saves/old",
      slot: 4,
      lastSyncedHash: "old",
      lastSyncedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    }),
    installSaveToSlot: async () => {
      return {
        path: "/saves/savegame9",
        contentHash: HASH,
        backupPath: null,
        wasEmpty: false,
      };
    },
    writeSyncState: async (_farmId, state) => {
      written = state;
      return state;
    },
  });

  const result = await runDownload(INPUT, deps, { confirm: () => true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "complete");
  if (result.outcome !== "complete") return;
  assert.ok(written, "sync state was written");
  assert.equal(result.state.lastDownloadedHash, HASH);
  assert.ok(result.state.lastDownloadedAt, "download time is stamped");
  assert.equal(result.state.localHash, HASH);
  assert.equal(result.state.lastSyncedHash, HASH);
  assert.equal(result.state.lastUploadedHash, "up", "other fields preserved");
  assert.equal(result.state.boundSavePath, "/saves/savegame9", "path comes from install");
  assert.equal(result.state.slot, 1, "slot is the download target");
});

test("the partial-success copy is the shared contract constant", async () => {
  const { deps } = makeDeps({
    writeSyncState: async () => {
      throw new Error("disk full");
    },
  });

  const result = await runDownload(INPUT, deps, { confirm: () => true });

  assert.equal(result.ok, true);
  if (!result.ok || result.outcome !== "partial") return;
  assert.equal(result.message, INSTALLED_NOT_RECORDED_MESSAGE(1, "disk full"));
});

test("recovery reports a pre-existing slot conflict instead of overwriting it", async () => {
  // Ticket 80: the post-install binding hits a slot already owned by another
  // farm (pre-existing conflicting binding). Recovery must report it clearly —
  // never silently steal the slot or claim the save is unchanged.
  const { deps, calls } = makeDeps({
    setFarmSlot: async () => {
      calls.push("setSlot-conflict");
      throw { kind: "slotConflict", slot: 1, ownerFarmId: "f9" };
    },
  });

  const result = await runDownload(INPUT, deps, { confirm: () => true });

  assert.equal(result.ok, true);
  if (!result.ok || result.outcome !== "partial") return;
  assert.ok(
    result.message.includes("Slot 1 is already linked to another farm; choose a different slot"),
    "the conflicting binding is reported clearly",
  );
  assert.ok(!result.message.includes(ORIGINAL_SAVE_RECOVERABLE_MESSAGE));
  assert.ok(!calls.includes("writeSync"), "the conflicting slot is never written");
});
