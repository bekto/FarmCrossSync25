import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_CONFIRMATION_MESSAGE,
  DOWNLOAD_TO_EMPTY_SLOT_MESSAGE,
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
    createBackup: async () => {
      calls.push("backup");
      return {
        backupPath: "/backups/savegame1_backup",
        createdAt: NOW,
        pruned: [],
      };
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
        backupPath: "/backups/savegame1_backup",
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

test("happy path confirms, backs up, fetches, verifies, replaces, then writes sync state", async () => {
  const { deps, calls } = makeDeps();
  const phases: DownloadPhase[] = [];

  const result = await runDownload(INPUT, deps, {
    onPhase: (phase) => phases.push(phase),
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sha256, HASH);
  assert.equal(result.backupPath, "/backups/savegame1_backup");
  assert.equal(result.state.slot, 1, "sync state records the target slot");
  assert.equal(result.state.boundSavePath, "/saves/savegame1");

  const flow = calls.filter(
    (c) => c !== "readSync" && c !== "cleanupArchive" && c !== "cleanupStaging",
  );
  assert.deepEqual(flow, [
    "confirm",
    "metadata",
    "backup",
    "authorize",
    "fetch",
    "unpack",
    "hash",
    "install",
    "setSlot",
    "writeSync",
  ]);
  assert.ok(calls.indexOf("backup") < calls.indexOf("fetch"));
  assert.ok(calls.indexOf("hash") < calls.indexOf("install"));
  assert.ok(calls.indexOf("install") < calls.indexOf("setSlot"));
  assert.ok(calls.indexOf("setSlot") < calls.indexOf("writeSync"));
  assert.ok(calls.includes("cleanupArchive"), "temp archive cleaned up on success");
  assert.ok(calls.includes("cleanupStaging"), "staging cleaned up on success");
  assert.deepEqual(phases, [
    "confirming",
    "backing-up",
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
  assert.ok(!calls.includes("backup"));
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
  assert.ok(calls.includes("backup"), "backup ran before verification");
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

test("setFarmSlot failure reports the error and writes no state", async () => {
  const { deps, calls } = makeDeps({
    setFarmSlot: async () => {
      calls.push("setSlot-failed");
      throw new Error("bind failed");
    },
  });

  const result = await runDownload(INPUT, deps, {
    confirm: confirmSpy(calls, true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "error");
  assert.ok(calls.includes("install"), "install ran before the binding failed");
  assert.ok(!calls.includes("writeSync"));
  assert.ok(calls.includes("cleanupArchive"));
  assert.ok(calls.includes("cleanupStaging"));
});

test("empty slot skips preflight and backup, installs, and binds the slot", async () => {
  let installArgs:
    | { root: string; slot: number; stagedPath: string; expectedHash?: string | null }
    | null = null;
  const { deps, calls } = makeDeps({
    installSaveToSlot: async (root, slot, stagedPath, expectedHash) => {
      installArgs = { root, slot, stagedPath, expectedHash };
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
  assert.ok(!calls.includes("backup"), "no backup for empty slot");
  assert.ok(calls.includes("install"));
  assert.ok(calls.includes("setSlot"));
  assert.ok(calls.includes("writeSync"));
  assert.equal(result.backupPath, null, "empty slot has no backup path");
  assert.equal(result.state.slot, 1);
  assert.equal(result.state.boundSavePath, "/saves/savegame1");
  assert.deepEqual(installArgs, {
    root: "/saves",
    slot: 1,
    stagedPath: "/tmp/staged",
    expectedHash: HASH,
  });
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
  assert.ok(written, "sync state was written");
  assert.equal(result.state.lastDownloadedHash, HASH);
  assert.ok(result.state.lastDownloadedAt, "download time is stamped");
  assert.equal(result.state.localHash, HASH);
  assert.equal(result.state.lastSyncedHash, HASH);
  assert.equal(result.state.lastUploadedHash, "up", "other fields preserved");
  assert.equal(result.state.boundSavePath, "/saves/savegame9", "path comes from install");
  assert.equal(result.state.slot, 1, "slot is the download target");
});
