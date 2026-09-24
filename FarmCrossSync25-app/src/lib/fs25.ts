// Typed wrappers around the FS25 Tauri commands.
// Contract source of truth: src-tauri/src/fs25/contract.rs.
// Each command resolves with the typed result or rejects with Fs25Error.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ValidationState = "valid" | "suspicious" | "invalid" | "inaccessible";

export interface SaveCandidate {
  slot: number | null;
  mapName: string | null;
  path: string;
  lastModified: string | null;
}

export interface ValidationResult {
  state: ValidationState;
  path: string;
  mapName: string | null;
  lastModified: string | null;
  missingFiles: string[];
  message: string | null;
}

export interface SaveMetadata {
  slot: number | null;
  mapName: string | null;
  path: string;
  lastModified: string | null;
  sizeBytes: number;
  contentHash: string;
}

export interface HashResult {
  path: string;
  hash: string;
}

export interface BackupResult {
  backupPath: string;
  createdAt: string;
  pruned: string[];
}

export interface ReplaceResult {
  replaced: boolean;
  backupPath: string | null;
  contentHash: string;
}

export interface PackResult {
  archivePath: string;
  sizeBytes: number;
  fileCount: number;
}

export interface UnpackResult {
  destPath: string;
  fileCount: number;
}

export interface PackProgress {
  savePath: string;
  percent: number;
}

export const PACK_PROGRESS_EVENT = "fs25-pack-progress";

export interface SyncState {  farmId: string;
  localHash: string | null;
  lastUploadedHash: string | null;
  lastUploadedAt: string | null;
  lastDownloadedHash: string | null;
  lastDownloadedAt: string | null;
  boundSavePath: string | null;
  slot: number | null;
  lastSyncedHash: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
}

export interface SlotInfo {
  slot: number;
  path: string;
  used: boolean;
  validation: ValidationState | null;
  mapName: string | null;
  lastModified: string | null;
}

export interface InstallResult {
  path: string;
  contentHash: string;
  backupPath: string | null;
  wasEmpty: boolean;
}

export interface SlotBinding {
  farmId: string;
  slot: number;
}

export type Fs25Error =
  | { kind: "notImplemented"; command: string }
  | { kind: "inaccessible"; path: string; message: string }
  | { kind: "internal"; message: string };

export function scanSaves(root?: string | null): Promise<SaveCandidate[]> {
  return invoke("scan_saves", { root: root ?? null });
}

export function validateSave(path: string): Promise<ValidationResult> {
  return invoke("validate_save", { path });
}

export function readMetadata(path: string): Promise<SaveMetadata> {
  return invoke("read_metadata", { path });
}

export function computeHash(path: string): Promise<HashResult> {
  return invoke("compute_hash", { path });
}

export function createBackup(
  savePath: string,
  backupDir?: string | null,
): Promise<BackupResult> {
  return invoke("create_backup", { savePath, backupDir: backupDir ?? null });
}

export function replaceSave(
  targetPath: string,
  stagedPath: string,
  expectedHash?: string | null,
): Promise<ReplaceResult> {
  return invoke("replace_save", {
    targetPath,
    stagedPath,
    expectedHash: expectedHash ?? null,
  });
}

export function cleanupPack(archivePath: string): Promise<void> {
  return invoke("cleanup_pack", { archivePath });
}

/**
 * Persist downloaded archive bytes to a fresh temp file and resolve its path.
 * The download transport stages fetched bytes through this scoped command; the
 * caller removes the file with `cleanupPack`.
 */
export function writeTempArchive(contents: Uint8Array): Promise<string> {
  return invoke("write_temp_archive", { contents: Array.from(contents) });
}

export function unpackSave(
  archivePath: string,
  destDir?: string | null,
): Promise<UnpackResult> {
  return invoke("unpack_save", { archivePath, destDir: destDir ?? null });
}

export function cleanupUnpack(destPath: string): Promise<void> {
  return invoke("cleanup_unpack", { destPath });
}

export function packSave(
  savePath: string,
  outDir?: string | null,
): Promise<PackResult> {
  return invoke("pack_save", { savePath, outDir: outDir ?? null });
}

export function onPackProgress(
  handler: (progress: PackProgress) => void,
): Promise<UnlistenFn> {
  return listen<PackProgress>(PACK_PROGRESS_EVENT, (event) =>
    handler(event.payload),
  );
}

export function readSyncState(farmId: string): Promise<SyncState | null> {
  return invoke("read_sync_state", { farmId });
}

export function writeSyncState(farmId: string, state: SyncState): Promise<SyncState> {
  return invoke("write_sync_state", { farmId, state });
}

export function setFarmSlot(
  farmId: string,
  root: string,
  slot: number,
): Promise<SyncState> {
  return invoke("set_farm_slot", { farmId, root, slot });
}

export function listSlots(root: string): Promise<SlotInfo[]> {
  return invoke("list_slots", { root });
}

export function detectFs25Roots(): Promise<string[]> {
  return invoke("detect_fs25_roots");
}

export function listSlotBindings(): Promise<SlotBinding[]> {
  return invoke("list_slot_bindings");
}

export function installSaveToSlot(
  root: string,
  slot: number,
  stagedPath: string,
  expectedHash?: string | null,
  backupDir?: string | null,
): Promise<InstallResult> {
  return invoke("install_save_to_slot", {
    root,
    slot,
    stagedPath,
    expectedHash: expectedHash ?? null,
    backupDir: backupDir ?? null,
  });
}
