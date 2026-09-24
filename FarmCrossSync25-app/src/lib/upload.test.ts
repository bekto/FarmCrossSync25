import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_SAVE_SAFE_MESSAGE,
  runUpload,
  SIZE_WARNING_BYTES,
  type UploadDeps,
  type UploadProgress,
} from "./upload.ts";
import { detectConflict } from "./conflict.ts";
import type { PackProgress, SyncState } from "./fs25.ts";

const HASH = "a".repeat(64);
const UPLOADED_AT = "2026-09-22T10:00:00.000Z";

function makeDeps(overrides: Partial<UploadDeps> = {}) {
  const calls: string[] = [];
  let progressHandler: ((progress: PackProgress) => void) | null = null;

  const deps: UploadDeps = {
    validateSave: async () => {
      calls.push("validate");
      return {
        state: "valid",
        path: "/saves/savegame1",
        mapName: "Riverbend Springs",
        lastModified: UPLOADED_AT,
        missingFiles: [],
        message: null,
      };
    },
    readMetadata: async () => {
      calls.push("metadata");
      return {
        slot: 1,
        mapName: "Riverbend Springs",
        path: "/saves/savegame1",
        lastModified: UPLOADED_AT,
        sizeBytes: 10,
        contentHash: HASH,
      };
    },
    packSave: async (savePath) => {
      calls.push("pack");
      progressHandler?.({ savePath, percent: 42 });
      return { archivePath: "/tmp/save.zip", sizeBytes: 8, fileCount: 3 };
    },
    onPackProgress: async (handler) => {
      progressHandler = handler;
      return () => {
        calls.push("unlisten");
      };
    },
    computeHash: async () => {
      calls.push("hash");
      return { hash: HASH };
    },
    uploadAuthorize: async () => {
      calls.push("authorize");
      return {
        objectKey: "farms/f1/players/u1/save",
        url: "https://r2.example/farms/f1/players/u1/save",
        method: "PUT",
        headers: { "content-type": "application/zip" },
        expiresAt: UPLOADED_AT,
      };
    },
    putToR2: async () => {
      calls.push("put");
    },
    uploadComplete: async () => {
      calls.push("complete");
      return { uploadedAt: UPLOADED_AT };
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
      calls.push("cleanup");
    },
    ...overrides,
  };

  return { deps, calls };
}

test("happy path runs validate→pack→hash→authorize→put→complete→sync-state", async () => {
  const { deps, calls } = makeDeps();
  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.uploadedAt, UPLOADED_AT);
  assert.equal(result.sha256, HASH);
  assert.equal(result.objectKey, "farms/f1/players/u1/save");
  assert.equal(result.saveName, "Riverbend Springs");

  const flow = calls.filter((c) => c !== "readSync" && c !== "unlisten" && c !== "cleanup");
  assert.deepEqual(flow, [
    "validate",
    "metadata",
    "pack",
    "hash",
    "authorize",
    "put",
    "complete",
    "writeSync",
  ]);
  assert.ok(calls.indexOf("complete") < calls.indexOf("writeSync"));
  assert.ok(calls.includes("cleanup"), "temp archive cleaned up on success");
});

test("emits two phases with zipping progress from pack events", async () => {
  const { deps } = makeDeps();
  const phases: string[] = [];
  const progress: UploadProgress[] = [];

  await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
    {
      onPhase: (phase) => phases.push(phase),
      onProgress: (p) => progress.push(p),
    },
  );

  assert.deepEqual(phases, ["zipping", "uploading"]);
  assert.ok(
    progress.some((p) => p.phase === "zipping" && p.percent === 42),
    "pack progress is surfaced",
  );
  assert.deepEqual(
    progress.filter((p) => p.percent === 100).map((p) => p.phase),
    ["zipping", "uploading"],
  );
});

test("mid-flow failure skips upload-complete and promises the local save is safe", async () => {
  const { deps, calls } = makeDeps({
    putToR2: async () => {
      calls.push("put-failed");
      throw new Error("network down");
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "error");
  assert.ok(result.message.includes(LOCAL_SAVE_SAFE_MESSAGE));
  assert.ok(result.message.includes("network down"));
  assert.ok(!calls.includes("complete"), "upload-complete is not called");
  assert.ok(!calls.includes("writeSync"), "sync state is not written on failure");
  assert.ok(calls.includes("cleanup"), "temp archive cleaned up on failure");
});

test("invalid save aborts before packing or authorizing", async () => {
  const { deps, calls } = makeDeps({
    validateSave: async () => ({
      state: "invalid",
      path: "/saves/nope",
      mapName: null,
      lastModified: null,
      missingFiles: [],
      message: null,
    }),
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/nope" },
    deps,
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "validation");
  assert.ok(result.message.includes(LOCAL_SAVE_SAFE_MESSAGE));
  assert.ok(!calls.includes("pack"));
  assert.ok(!calls.includes("authorize"));
});

test("large save warns and proceeds when confirmed", async () => {
  const warned: number[] = [];
  const { deps, calls } = makeDeps({
    readMetadata: async () => {
      calls.push("metadata");
      return {
        slot: 1,
        mapName: "Big",
        path: "/saves/big",
        lastModified: UPLOADED_AT,
        sizeBytes: SIZE_WARNING_BYTES + 1,
        contentHash: HASH,
      };
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/big" },
    deps,
    { confirmSizeWarning: (size) => (warned.push(size), true) },
  );

  assert.deepEqual(warned, [SIZE_WARNING_BYTES + 1]);
  assert.equal(result.ok, true);
  assert.ok(calls.includes("complete"));
});

test("large save aborts cleanly when the warning is dismissed", async () => {
  const { deps, calls } = makeDeps({
    readMetadata: async () => {
      calls.push("metadata");
      return {
        slot: 1,
        mapName: "Big",
        path: "/saves/big",
        lastModified: UPLOADED_AT,
        sizeBytes: SIZE_WARNING_BYTES + 1,
        contentHash: HASH,
      };
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/big" },
    deps,
    { confirmSizeWarning: () => false },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "size-warning");
  assert.ok(result.message.includes(LOCAL_SAVE_SAFE_MESSAGE));
  assert.ok(!calls.includes("pack"), "nothing is packed after a cancelled warning");
  assert.ok(!calls.includes("authorize"));
  assert.ok(!calls.includes("complete"));
});

test("sync state records the uploaded hash and time after completion", async () => {
  let written: { farmId: string; state: SyncState } | null = null;
  const { deps } = makeDeps({
    readSyncState: async () => ({
      farmId: "f1",
      localHash: "old",
      lastUploadedHash: "old",
      lastUploadedAt: "2020-01-01T00:00:00.000Z",
      lastDownloadedHash: "dl",
      lastDownloadedAt: "2020-01-01T00:00:00.000Z",
      boundSavePath: "/saves/savegame1",
      slot: 4,
      lastSyncedHash: null,
      lastSyncedAt: null,
      updatedAt: null,
    }),
    writeSyncState: async (farmId, state) => {
      written = { farmId, state };
      return state;
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.ok(written);
  if (!written) return;
  const { farmId, state } = written;
  assert.equal(farmId, "f1");
  assert.equal(state.lastUploadedHash, HASH);
  assert.equal(state.lastUploadedAt, UPLOADED_AT);
  assert.equal(state.localHash, HASH);
  assert.equal(state.lastDownloadedHash, "dl", "other fields are preserved");
  assert.equal(state.slot, 4, "slot preserved");
});

// --- Ticket 73: the upload is the most recent sync baseline ----------------

test("a successful upload advances the sync baseline", async () => {
  let written: SyncState | null = null;
  const { deps } = makeDeps({
    readSyncState: async () => ({
      farmId: "f1",
      localHash: "old",
      lastUploadedHash: "older-up",
      lastUploadedAt: "2020-01-01T00:00:00.000Z",
      lastDownloadedHash: "dl",
      lastDownloadedAt: "2020-01-02T00:00:00.000Z",
      boundSavePath: "/saves/savegame1",
      slot: 4,
      lastSyncedHash: "older-sync",
      lastSyncedAt: "2020-01-03T00:00:00.000Z",
      updatedAt: "2020-01-04T00:00:00.000Z",
    }),
    writeSyncState: async (_farmId, state) => {
      written = state;
      return state;
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.ok(written);
  if (!written) return;
  // The uploaded hash and timestamp are the most recent sync baseline.
  assert.equal(written.lastSyncedHash, HASH);
  assert.equal(written.lastSyncedAt, UPLOADED_AT);
  assert.equal(written.lastUploadedHash, HASH);
  assert.equal(written.lastUploadedAt, UPLOADED_AT);
  // Unrelated per-farm state survives the merge.
  assert.equal(written.boundSavePath, "/saves/savegame1", "bound slot preserved");
  assert.equal(written.slot, 4, "slot preserved");
  assert.equal(written.lastDownloadedHash, "dl", "download history preserved");
  assert.equal(written.lastDownloadedAt, "2020-01-02T00:00:00.000Z");
});

test("a failed upload leaves the previous sync baseline byte-identical", async () => {
  const previous: SyncState = {
    farmId: "f1",
    localHash: "old",
    lastUploadedHash: "up",
    lastUploadedAt: "2020-01-01T00:00:00.000Z",
    lastDownloadedHash: "dl",
    lastDownloadedAt: "2020-01-02T00:00:00.000Z",
    boundSavePath: "/saves/savegame1",
    slot: 4,
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
    putToR2: async () => {
      calls.push("put-failed");
      throw new Error("network down");
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, false);
  assert.ok(!calls.includes("writeSync"), "no state write on failure");
  assert.equal(JSON.stringify(stored), before, "baseline byte-identical");
});

test("upload-then-modify triggers conflict detection before a download", async () => {
  let written: SyncState | null = null;
  const { deps } = makeDeps({
    writeSyncState: async (_farmId, state) => {
      written = state;
      return state;
    },
  });

  const result = await runUpload(
    { farmId: "f1", savePath: "/saves/savegame1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.ok(written);
  if (!written) return;
  // An unchanged local save matches the new baseline: no conflict.
  assert.equal(
    detectConflict({ localHash: HASH, lastSyncedHash: written.lastSyncedHash }),
    false,
  );
  // A local modification after the upload conflicts before the cloud download.
  assert.equal(
    detectConflict({
      localHash: "b".repeat(64),
      lastSyncedHash: written.lastSyncedHash,
    }),
    true,
  );
});
