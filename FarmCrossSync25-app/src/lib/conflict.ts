// Conflict detection + gate for "Download & Replace" (ticket 32).
//
// DOM-, Tauri-, and network-free: the dialog is injected so this can run under
// `node --test` with fakes. Spec (cloud-save-sync): "If the local save changed
// since the last sync, a conflict warning appears first: Keep My Save /
// Download Cloud Save / Cancel. Never silently destroy a newer local save."
//
// The gate is deliberately small and lives outside `runDownload`; callers use
// `runDownloadWithConflict` (or call `resolveConflict` themselves) before
// `runDownload` so the dialog is consulted before any backup/fetch/replace.
//
// Null-hash semantics (documented, per ticket):
//   - `lastSyncedHash === null` means no sync has completed yet (first sync);
//     there is nothing the user could lose, so there is no conflict.
//   - `localHash === null` means the local save's content hash is unknown or
//     unreadable. We cannot prove the local save is unchanged, so the safest
//     choice is to warn: treat it as a conflict.
//   - An empty string is never a hash: it is normalized to "unknown" (null) so
//     a placeholder can never silently compare as a differing hash.

import {
  runDownload,
  type DownloadCallbacks,
  type DownloadDeps,
  type DownloadInput,
  type DownloadResult,
} from "./download.ts";

/** Copy shown in the conflict warning. */
export const CONFLICT_MESSAGE =
  "This local save has changed since your last sync. Downloading the cloud save will replace it.";

/** Shown after Keep My Save / Cancel; local data is untouched. */
export const CONFLICT_CANCELLED_MESSAGE =
  "Your local save was kept and is unchanged.";

/** The three actions offered by the conflict dialog. */
export type ConflictChoice = "keep" | "download" | "cancel";

/** The gate's decision. Identical vocabulary to the dialog's choice. */
export type ConflictDecision = ConflictChoice;

/** Injected dialog: presents the warning and resolves with the user's choice. */
export type ConflictDialog = (
  message: string,
) => ConflictChoice | Promise<ConflictChoice>;

export interface DetectConflictInput {
  localHash: string | null;
  lastSyncedHash: string | null;
}

/** Case-insensitive hex comparison. */
function sameHash(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * True when a download could destroy a local save that changed since the last
 * sync: both hashes are present and differ. First sync (`lastSyncedHash` null)
 * is never a conflict; an unknown local hash is treated as a conflict because
 * the local state cannot be verified (see file header). An empty string is
 * never a hash: it counts as "unknown" (null), never as a matching hash.
 */
export function detectConflict({
  localHash,
  lastSyncedHash,
}: DetectConflictInput): boolean {
  const synced = lastSyncedHash === null || lastSyncedHash === "" ? null : lastSyncedHash;
  if (synced === null) return false;
  const local = localHash === null || localHash === "" ? null : localHash;
  if (local === null) return true;
  return !sameHash(local, synced);
}

export interface ResolveConflictInput extends DetectConflictInput {
  /** Invoked only when a conflict exists. */
  choose: ConflictDialog;
}

/**
 * Consult the conflict gate. With no conflict, resolves `"download"` and does
 * not invoke the dialog. With a conflict, invokes `choose` and returns its
 * choice verbatim.
 */
export async function resolveConflict({
  localHash,
  lastSyncedHash,
  choose,
}: ResolveConflictInput): Promise<ConflictDecision> {
  if (!detectConflict({ localHash, lastSyncedHash })) return "download";
  return await choose(CONFLICT_MESSAGE);
}

export interface DownloadConflictOptions extends DetectConflictInput {
  choose: ConflictDialog;
}

/**
 * Run a download behind the conflict gate. The gate is consulted first; only a
 * `"download"` decision reaches `runDownload`. `"keep"` and `"cancel"` both
 * abort with a cancelled result and run no backup/fetch/replace, leaving local
 * data untouched.
 */
export async function runDownloadWithConflict(
  input: DownloadInput,
  deps: DownloadDeps,
  callbacks: DownloadCallbacks = {},
  conflict: DownloadConflictOptions,
): Promise<DownloadResult> {
  const decision = await resolveConflict(conflict);
  if (decision !== "download") {
    return {
      ok: false,
      reason: "cancelled",
      message: `Download cancelled. ${CONFLICT_CANCELLED_MESSAGE}`,
    };
  }
  return runDownload(input, deps, callbacks);
}
