// Confirmed "Download & Replace" flow (ticket 31).
//
// DOM-, Tauri-, and network-free: every side effect is injected so the flow can
// run under `node --test` with fakes and a farm screen can render the progress
// it emits. The downloaded archive is fetched straight from the presigned URL by
// the injected `fetchArchive`; save bytes never pass through the Worker.
//
// Sequence: confirm -> (used slot: preflight the local save) -> authorize + fetch
// archive -> unpack to a staging dir -> hash the extracted content and compare
// to the expected sha256 -> install into the chosen slot -> bind the farm to the
// slot -> write sync state.
//
// The install is the only step that changes local content: the authoritative
// Rust replacement creates the one backup (under the configured backup
// directory, ticket 87) before it swaps a used slot, and creates no backup for
// an empty slot. Bookkeeping after the install runs in its own recovery phase
// (ticket 75): it retries once to reconcile, and on failure reports the save as
// installed — never as "unchanged". Everything before a completed install
// (including a rolled-back install failure) leaves the original save untouched
// and recoverable.

import type {
  HashResult,
  InstallResult,
  SaveMetadata,
  SyncState,
  UnpackResult,
} from "./fs25.ts";
import { slotConflictMessage } from "./fs25.ts";

/** Copy shown in the confirmation step; the user must confirm it. */
export const DOWNLOAD_CONFIRMATION_MESSAGE =
  "This will replace your current local FS25 save. A backup will automatically be created first.";

/** Copy shown when the download targets an Empty slot; no backup is made. */
export const DOWNLOAD_TO_EMPTY_SLOT_MESSAGE = (slot: number): string =>
  `This will install the save into empty Slot ${slot}.`;

/** Shown when the extracted content hash does not match the expected hash. */
export const VERIFICATION_FAILED_MESSAGE =
  "Download verification failed: the downloaded save did not match the expected content hash. Your original save was not replaced.";

/** Failure copy always carries this promise (desktop-ui: local data is safe). */
export const ORIGINAL_SAVE_RECOVERABLE_MESSAGE =
  "Your original save is unchanged and recoverable.";

/**
 * Accurate partial-success copy (ticket 75): the save WAS installed and only
 * the bookkeeping failed. This must never claim the original save is
 * unchanged — the result type keeps the two outcomes apart so the copy can't.
 */
export const INSTALLED_NOT_RECORDED_MESSAGE = (slot: number, detail: string): string =>
  `The cloud save was installed to Slot ${slot}, but the app could not record the sync state: ${detail}. Your new save is in place.`;

/** Phases surfaced to the UI, in order. */
export type DownloadPhase =
  | "confirming"
  | "downloading"
  | "unpacking"
  | "verifying"
  | "replacing";

export interface DownloadProgress {
  phase: DownloadPhase;
  /** 0-100 within the current phase. */
  percent: number;
}

/** Temporary read authorization returned by `POST /saves/:playerId/download-authorize`. */
export interface DownloadAuthorization {
  objectKey: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
  [key: string]: unknown;
}

export interface DownloadDeps {
  readMetadata(path: string): Promise<SaveMetadata>;
  computeHash(path: string): Promise<HashResult>;
  downloadAuthorize(input: {
    farmId: string;
    playerId: string;
    baseUrl: string;
  }): Promise<DownloadAuthorization>;
  fetchArchive(
    authorization: DownloadAuthorization,
  ): Promise<{ archivePath: string }>;
  unpackSave(archivePath: string, destDir?: string | null): Promise<UnpackResult>;
  /**
   * Install the staged save into the slot. The authoritative Rust replacement
   * creates the single backup under `backupDir` before swapping a used slot and
   * no backup for an empty slot (ticket 87).
   */
  installSaveToSlot(
    root: string,
    slot: number,
    stagedPath: string,
    expectedHash?: string | null,
    backupDir?: string | null,
  ): Promise<InstallResult>;
  setFarmSlot(farmId: string, root: string, slot: number): Promise<SyncState>;
  readSyncState(farmId: string): Promise<SyncState | null>;
  writeSyncState(farmId: string, state: SyncState): Promise<SyncState>;
  cleanupPack(archivePath: string): Promise<void>;
  cleanupUnpack(destPath: string): Promise<void>;
}

export interface DownloadInput {
  farmId: string;
  playerId: string;
  /** FS25 folder that contains the slot folders. */
  fs25Root: string;
  /** Target slot number (1..=20). */
  slot: number;
  /** Absolute path of the target slot folder, from `SlotInfo.path`. */
  slotPath: string;
  /** True when the target slot already holds a save (folder existence). */
  slotUsed: boolean;
  /** SHA-256 from the cloud save metadata; the extracted content must match. */
  expectedSha256: string;
  apiBaseUrl: string;
  /** Configured backup directory for the replacement's backup; null = default. */
  backupDir: string | null;
}

export interface DownloadCallbacks {
  onPhase?(phase: DownloadPhase): void;
  onProgress?(progress: DownloadProgress): void;
  /** Return false to abort before any change. Absent => proceed. */
  confirm?(message: string): boolean | Promise<boolean>;
}

/** Install and slot binding + sync state all persisted. */
export interface DownloadComplete {
  ok: true;
  outcome: "complete";
  /** The persisted sync state after the successful install. */
  state: SyncState;
  sha256: string;
  /** The backup the replacement actually created; null for an empty slot. */
  backupPath: string | null;
  syncedAt: string;
}

/**
 * The save was installed but the slot binding / sync-state write could not be
 * reconciled (ticket 75). This is a success: the original save was replaced,
 * so failure copy promising an unchanged original would be a lie.
 */
export interface DownloadPartial {
  ok: true;
  outcome: "partial";
  /** Nothing was persisted: the bookkeeping failed. */
  state: null;
  /** Accurate partial-success copy: the save WAS installed. */
  message: string;
  sha256: string;
  backupPath: string | null;
  syncedAt: string;
}

export type DownloadSuccess = DownloadComplete | DownloadPartial;

export type DownloadFailureReason = "cancelled" | "verification" | "error";

export interface DownloadFailure {
  ok: false;
  reason: DownloadFailureReason;
  message: string;
  error?: unknown;
}

export type DownloadResult = DownloadSuccess | DownloadFailure;

/** Flatten a thrown cause to the detail shown in user-facing copy. */
function detailOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const obj = cause as Record<string, unknown>;
    if (obj.kind === "slotConflict" && typeof obj.slot === "number") {
      return slotConflictMessage(obj.slot);
    }
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  return String(cause);
}

/**
 * Everything up to and including the install: confirm, (used-slot preflight),
 * fetch, unpack, verify, replace. A cancelled flow or any failure here leaves
 * the original save untouched; on the resolved install result the save IS
 * replaced. Temporary archive/staging cleanup runs in every case first.
 */
async function installPhase(
  input: DownloadInput,
  deps: DownloadDeps,
  { onPhase, onProgress, confirm }: DownloadCallbacks,
): Promise<{ ok: true; hash: string; installed: InstallResult } | DownloadFailure> {
  const {
    farmId,
    playerId,
    fs25Root,
    slot,
    slotPath,
    slotUsed,
    expectedSha256,
    apiBaseUrl,
    backupDir,
  } = input;
  let archivePath: string | null = null;
  let stagedPath: string | null = null;

  try {
    onPhase?.("confirming");
    const proceed = confirm
      ? await confirm(
          slotUsed
            ? DOWNLOAD_CONFIRMATION_MESSAGE
            : DOWNLOAD_TO_EMPTY_SLOT_MESSAGE(slot),
        )
      : true;
    if (!proceed) {
      return {
        ok: false,
        reason: "cancelled",
        message: `Download cancelled. ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
      };
    }

    // A used slot is preflighted so a broken local save aborts before anything
    // runs; an empty slot has nothing to read. No backup is made here — the
    // replacement creates the one authoritative backup (ticket 87).
    if (slotUsed) {
      await deps.readMetadata(slotPath);
    }

    onPhase?.("downloading");
    onProgress?.({ phase: "downloading", percent: 0 });
    const authorization = await deps.downloadAuthorize({
      farmId,
      playerId,
      baseUrl: apiBaseUrl,
    });
    const fetched = await deps.fetchArchive(authorization);
    archivePath = fetched.archivePath;
    onProgress?.({ phase: "downloading", percent: 100 });

    onPhase?.("unpacking");
    onProgress?.({ phase: "unpacking", percent: 0 });
    const unpacked = await deps.unpackSave(archivePath);
    stagedPath = unpacked.destPath;
    onProgress?.({ phase: "unpacking", percent: 100 });

    onPhase?.("verifying");
    onProgress?.({ phase: "verifying", percent: 0 });
    const { hash } = await deps.computeHash(stagedPath);
    // Case-insensitive hex comparison; a mismatch aborts before install.
    if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
      return {
        ok: false,
        reason: "verification",
        message: `${VERIFICATION_FAILED_MESSAGE} ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
      };
    }
    onProgress?.({ phase: "verifying", percent: 100 });

    onPhase?.("replacing");
    onProgress?.({ phase: "replacing", percent: 0 });
    const installed = await deps.installSaveToSlot(
      fs25Root,
      slot,
      stagedPath,
      expectedSha256,
      backupDir,
    );
    onProgress?.({ phase: "replacing", percent: 100 });
    return { ok: true, hash, installed };
  } catch (cause) {
    // Cancelled pre-install work or a failed (rolled-back) install: the
    // original save is untouched and recoverable.
    return {
      ok: false,
      reason: "error",
      message: `Download failed: ${detailOf(cause)}. ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
      error: cause,
    };
  } finally {
    if (archivePath) {
      try {
        await deps.cleanupPack(archivePath);
      } catch {
        // the temp archive is disposable; failed cleanup must not fail download
      }
    }
    if (stagedPath) {
      try {
        await deps.cleanupUnpack(stagedPath);
      } catch {
        // the staging dir is disposable; failed cleanup must not fail download
      }
    }
  }
}

/**
 * Run the confirmed download-and-install flow.
 *
 * Resolves a complete success (install, slot binding, and sync state all
 * recorded), a partial success (the save WAS installed but the bookkeeping
 * could not be reconciled — see [`DownloadPartial`]), or a pre-install failure
 * whose `message` promises the original save is recoverable. `installSaveToSlot`
 * is only called after the extracted content hash matches `expectedSha256`.
 */
export async function runDownload(
  input: DownloadInput,
  deps: DownloadDeps,
  callbacks: DownloadCallbacks = {},
): Promise<DownloadResult> {
  const phase = await installPhase(input, deps, callbacks);
  if (!phase.ok) return phase;

  const { hash, installed } = phase;
  const { farmId, fs25Root, slot } = input;

  // --- Recovery phase (ticket 75) ------------------------------------------
  // The install has replaced the slot: the save is IN. The bookkeeping below
  // runs outside the install's failure path so its failures can never produce
  // the "original save is unchanged" copy — that would be a lie from here on.
  // One retry reconciles a transient slot-binding or sync-state write failure.
  const syncedAt = new Date().toISOString();
  let bookkeepingError: unknown = null;
  let state: SyncState | null = null;
  for (let attempt = 0; attempt < 2 && state === null; attempt += 1) {
    try {
      await deps.setFarmSlot(farmId, fs25Root, slot);
      const existing = await deps.readSyncState(farmId);
      state = await deps.writeSyncState(farmId, {
        farmId,
        localHash: hash,
        lastUploadedHash: existing?.lastUploadedHash ?? null,
        lastUploadedAt: existing?.lastUploadedAt ?? null,
        lastDownloadedHash: hash,
        lastDownloadedAt: syncedAt,
        boundSavePath: installed.path,
        slot,
        lastSyncedHash: hash,
        lastSyncedAt: syncedAt,
        updatedAt: existing?.updatedAt ?? null,
      });
    } catch (cause) {
      bookkeepingError = cause;
    }
  }

  const shared = {
    sha256: hash,
    backupPath: installed.backupPath ?? null,
    syncedAt,
  };
  if (state !== null) {
    return { ok: true, outcome: "complete", state, ...shared };
  }
  return {
    ok: true,
    outcome: "partial",
    state: null,
    message: INSTALLED_NOT_RECORDED_MESSAGE(slot, detailOf(bookkeepingError)),
    ...shared,
  };
}
