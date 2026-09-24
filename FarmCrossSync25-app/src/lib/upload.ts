// One-click "Upload My Save" flow (ticket 30).
//
// DOM-, Tauri-, and network-free: every side effect is injected so the flow can
// run under `node --test` with fakes and a farm screen (ticket 35) can render
// the progress it emits. Save bytes never pass through the Worker — `putToR2`
// is the injected direct PUT to the presigned URL.
//
// Sequence: validate -> (size warning) -> pack (progress) -> hash -> authorize
// -> PUT to R2 -> upload-complete -> write sync state. upload-complete is the
// mutation point: if anything fails before it succeeds, the previous cloud save
// stays authoritative and the local save is untouched.

import type {
  PackProgress,
  PackResult,
  SaveMetadata,
  SyncState,
  ValidationResult,
} from "./fs25.ts";

/** Size above which the user is warned before uploading (spec: ~200 MB). */
export const SIZE_WARNING_BYTES = 200 * 1024 * 1024;

/** Two upload phases surfaced to the UI. */
export type UploadPhase = "zipping" | "uploading";

/** Promise-with-colinear shape of the `onPackProgress` Tauri wrapper. */
export type UnlistenFn = () => void;

/** Temporary write authorization returned by `POST /saves/upload-authorize`. */
export interface UploadAuthorization {
  objectKey: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
  [key: string]: unknown;
}

export interface UploadProgress {
  phase: UploadPhase;
  /** 0-100 within the current phase. */
  percent: number;
}

export interface UploadDeps {
  validateSave(path: string): Promise<ValidationResult>;
  readMetadata(path: string): Promise<SaveMetadata>;
  packSave(savePath: string, outDir?: string | null): Promise<PackResult>;
  onPackProgress(handler: (progress: PackProgress) => void): Promise<UnlistenFn>;
  computeHash(path: string): Promise<{ hash: string }>;
  uploadAuthorize(input: {
    farmId: string;
  }): Promise<UploadAuthorization>;
  putToR2(input: {
    archivePath: string;
    sizeBytes: number;
    authorization: UploadAuthorization;
  }): Promise<void>;
  uploadComplete(input: {
    farmId: string;
    objectKey: string;
    fileSize: number;
    sha256: string;
    saveName: string;
  }): Promise<{ uploadedAt: string }>;
  readSyncState(farmId: string): Promise<SyncState | null>;
  writeSyncState(farmId: string, state: SyncState): Promise<SyncState>;
  cleanupPack(archivePath: string): Promise<void>;
}

export interface UploadInput {
  farmId: string;
  savePath: string;
}

export interface UploadCallbacks {
  onPhase?(phase: UploadPhase): void;
  onProgress?(progress: UploadProgress): void;
  onWarning?(message: string): void;
  /** Return false to abort before packing. Absent => always proceed. */
  confirmSizeWarning?(sizeBytes: number): boolean | Promise<boolean>;
}

export interface UploadSuccess {
  ok: true;
  uploadedAt: string;
  sha256: string;
  fileSize: number;
  objectKey: string;
  saveName: string;
}

export type UploadFailureReason = "validation" | "size-warning" | "error";

export interface UploadFailure {
  ok: false;
  reason: UploadFailureReason;
  message: string;
  error?: unknown;
}

export type UploadResult = UploadSuccess | UploadFailure;

/** Failure copy always carries this promise (desktop-ui: local data is safe). */
export const LOCAL_SAVE_SAFE_MESSAGE =
  "Your local save is unchanged and safe.";

export const SUSPICIOUS_SAVE_MESSAGE =
  "This save looks like an FS25 save but expected files are missing. Uploading anyway.";

export const SIZE_WARNING_MESSAGE = (sizeBytes: number) =>
  `This save is ${Math.round(sizeBytes / (1024 * 1024))} MB, above the 200 MB warning threshold. You can still upload it.`;

const validationMessage = (state: string, fallback: string | null) =>
  fallback ??
  (state === "inaccessible"
    ? "The save folder could not be read."
    : "This folder is not an FS25 savegame.");

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "savegame";
}

/**
 * Run the upload flow. Resolves with the new `uploadedAt` on success, or a
 * failure whose `message` promises the local save is safe. `upload-complete`
 * is only called after the R2 put succeeds; sync state is only written after
 * `upload-complete` succeeds.
 */
export async function runUpload(
  input: UploadInput,
  deps: UploadDeps,
  {
    onPhase,
    onProgress,
    onWarning,
    confirmSizeWarning,
  }: UploadCallbacks = {},
): Promise<UploadResult> {
  const { farmId, savePath } = input;
  let archivePath: string | null = null;
  let unlisten: UnlistenFn | null = null;

  try {
    const validation = await deps.validateSave(savePath);
    if (validation.state === "invalid" || validation.state === "inaccessible") {
      return {
        ok: false,
        reason: "validation",
        message: `${validationMessage(validation.state, validation.message)} ${LOCAL_SAVE_SAFE_MESSAGE}`,
      };
    }
    if (validation.state === "suspicious") onWarning?.(SUSPICIOUS_SAVE_MESSAGE);

    const metadata = await deps.readMetadata(savePath);
    if (metadata.sizeBytes > SIZE_WARNING_BYTES) {
      const proceed = confirmSizeWarning
        ? await confirmSizeWarning(metadata.sizeBytes)
        : true;
      if (!proceed) {
        return {
          ok: false,
          reason: "size-warning",
          message: `Upload cancelled. ${LOCAL_SAVE_SAFE_MESSAGE}`,
        };
      }
    }

    onPhase?.("zipping");
    onProgress?.({ phase: "zipping", percent: 0 });
    unlisten = await deps.onPackProgress((progress) =>
      onProgress?.({ phase: "zipping", percent: progress.percent }),
    );
    const pack = await deps.packSave(savePath);
    archivePath = pack.archivePath;
    onProgress?.({ phase: "zipping", percent: 100 });

    const { hash } = await deps.computeHash(savePath);

    onPhase?.("uploading");
    onProgress?.({ phase: "uploading", percent: 0 });
    const authorization = await deps.uploadAuthorize({ farmId });
    await deps.putToR2({
      archivePath: pack.archivePath,
      sizeBytes: pack.sizeBytes,
      authorization,
    });
    onProgress?.({ phase: "uploading", percent: 100 });

    const saveName = metadata.mapName ?? baseName(savePath);
    const { uploadedAt } = await deps.uploadComplete({
      farmId,
      objectKey: authorization.objectKey,
      fileSize: pack.sizeBytes,
      sha256: hash,
      saveName,
    });

    const existing = await deps.readSyncState(farmId);
    await deps.writeSyncState(farmId, {
      farmId,
      localHash: hash,
      lastUploadedHash: hash,
      lastUploadedAt: uploadedAt,
      lastDownloadedHash: existing?.lastDownloadedHash ?? null,
      lastDownloadedAt: existing?.lastDownloadedAt ?? null,
      boundSavePath: existing?.boundSavePath ?? savePath,
      slot: existing?.slot ?? null,
      lastSyncedHash: existing?.lastSyncedHash ?? null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      updatedAt: existing?.updatedAt ?? null,
    });

    return {
      ok: true,
      uploadedAt,
      sha256: hash,
      fileSize: pack.sizeBytes,
      objectKey: authorization.objectKey,
      saveName,
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      reason: "error",
      message: `Upload failed: ${detail}. ${LOCAL_SAVE_SAFE_MESSAGE}`,
      error: cause,
    };
  } finally {
    try {
      unlisten?.();
    } catch {
      // progress listener teardown is best-effort
    }
    if (archivePath) {
      try {
        await deps.cleanupPack(archivePath);
      } catch {
        // the temp archive is disposable; a failed cleanup must not fail upload
      }
    }
  }
}
