// Confirmed "Download & Replace" flow (ticket 31).
//
// DOM-, Tauri-, and network-free: every side effect is injected so the flow can
// run under `node --test` with fakes and a farm screen can render the progress
// it emits. The downloaded archive is fetched straight from the presigned URL by
// the injected `fetchArchive`; save bytes never pass through the Worker.
//
// Sequence: confirm -> (used slot: back up the local save) -> authorize + fetch
// archive -> unpack to a staging dir -> hash the extracted content and compare
// to the expected sha256 -> install into the chosen slot -> bind the farm to the
// slot -> write sync state. Sync state is only written after a successful
// install, and any failure before or during install leaves the original save
// untouched and recoverable.

import type {
  BackupResult,
  HashResult,
  InstallResult,
  SaveMetadata,
  SyncState,
  UnpackResult,
} from "./fs25.ts";

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

/** Phases surfaced to the UI, in order. */
export type DownloadPhase =
  | "confirming"
  | "backing-up"
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
  createBackup(savePath: string, backupDir?: string | null): Promise<BackupResult>;
  downloadAuthorize(input: {
    farmId: string;
    playerId: string;
    baseUrl: string;
  }): Promise<DownloadAuthorization>;
  fetchArchive(
    authorization: DownloadAuthorization,
  ): Promise<{ archivePath: string }>;
  unpackSave(archivePath: string, destDir?: string | null): Promise<UnpackResult>;
  installSaveToSlot(
    root: string,
    slot: number,
    stagedPath: string,
    expectedHash?: string | null,
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
  /** True when the target slot already holds a save. */
  slotUsed: boolean;
  /** SHA-256 from the cloud save metadata; the extracted content must match. */
  expectedSha256: string;
  apiBaseUrl: string;
}

export interface DownloadCallbacks {
  onPhase?(phase: DownloadPhase): void;
  onProgress?(progress: DownloadProgress): void;
  /** Return false to abort before any change. Absent => proceed. */
  confirm?(message: string): boolean | Promise<boolean>;
}

export interface DownloadSuccess {
  ok: true;
  /** The persisted sync state after the successful install. */
  state: SyncState;
  sha256: string;
  backupPath: string | null;
  syncedAt: string;
}

export type DownloadFailureReason = "cancelled" | "verification" | "error";

export interface DownloadFailure {
  ok: false;
  reason: DownloadFailureReason;
  message: string;
  error?: unknown;
}

export type DownloadResult = DownloadSuccess | DownloadFailure;

/** Case-insensitive hex comparison. */
function sameHash(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Run the confirmed download-and-install flow.
 *
 * Resolves with the new sync state on success, or a failure whose `message`
 * promises the original save is recoverable. `installSaveToSlot` is only called
 * after the extracted content hash matches `expectedSha256`, and sync state is
 * only written after the install and the slot binding succeed.
 */
export async function runDownload(
  input: DownloadInput,
  deps: DownloadDeps,
  { onPhase, onProgress, confirm }: DownloadCallbacks = {},
): Promise<DownloadResult> {
  const {
    farmId,
    playerId,
    fs25Root,
    slot,
    slotPath,
    slotUsed,
    expectedSha256,
    apiBaseUrl,
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

    // A used slot is preflighted and backed up; an empty slot has nothing to
    // read or preserve, so both steps are skipped.
    let backup: BackupResult | null = null;
    if (slotUsed) {
      // Pre-flight: the bound local save must be readable before anything runs.
      await deps.readMetadata(slotPath);

      onPhase?.("backing-up");
      onProgress?.({ phase: "backing-up", percent: 0 });
      backup = await deps.createBackup(slotPath);
      onProgress?.({ phase: "backing-up", percent: 100 });
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
    if (!sameHash(hash, expectedSha256)) {
      // Abort before install: the original save is never touched.
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
    );
    onProgress?.({ phase: "replacing", percent: 100 });

    // The install succeeded: bind the farm to the slot before persisting state.
    await deps.setFarmSlot(farmId, fs25Root, slot);

    const existing = await deps.readSyncState(farmId);
    const syncedAt = new Date().toISOString();
    const state = await deps.writeSyncState(farmId, {
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

    return {
      ok: true,
      state,
      sha256: hash,
      backupPath: backup?.backupPath ?? null,
      syncedAt,
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      reason: "error",
      message: `Download failed: ${detail}. ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
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
