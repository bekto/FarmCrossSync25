// Error catalog, empty-state copy, and toast plumbing (ticket 39).
//
// Single source of truth for the spec-mandated error copy (desktop-ui:
// "Toasts / error states for: no internet, upload failed (local save safe),
// download failed (existing save not replaced), farm not found, already a
// member, pending request, savegame not found, invalid save, hash mismatch").
// DOM-, Tauri-, and network-free, so it runs under `node --test`; the Svelte
// components stay thin and just render this text.
//
// Failure copy tells the truth about local-save safety: every entry in
// LOCAL_SAVE_SAFE_ERRORS carries that promise (desktop-ui edge case: "Failed
// cloud operations always state that local data is safe").

import { writable } from "svelte/store";
import { LOCAL_SAVE_SAFE_MESSAGE } from "./upload.ts";
import {
  ORIGINAL_SAVE_RECOVERABLE_MESSAGE,
  VERIFICATION_FAILED_MESSAGE,
} from "./download.ts";
import { NEED_INTERNET_MESSAGE } from "./session.ts";

/** Every spec-mandated error situation. */
export type ErrorKey =
  | "no-internet"
  | "upload-failed"
  | "download-failed"
  | "farm-not-found"
  | "already-member"
  | "pending-request"
  | "savegame-not-found"
  | "invalid-save"
  | "hash-mismatch";

/**
 * User-facing copy per situation. The offline entry is the spec's exact
 * wording — "Unable to connect to cloud. Your local save has not been changed."
 * — which itself carries the local-save promise.
 */
export const ERROR_MESSAGES: Record<ErrorKey, string> = {
  "no-internet": NEED_INTERNET_MESSAGE,
  "upload-failed": `Upload failed. ${LOCAL_SAVE_SAFE_MESSAGE}`,
  "download-failed": `Download failed. ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
  "farm-not-found": "Farm not found. Check the farm code and try again.",
  "already-member": "You are already a member of this farm.",
  "pending-request":
    "Your join request is pending. The farm owner needs to accept it.",
  "savegame-not-found":
    `Savegame not found. Choose an FS25 save folder and try again. ${LOCAL_SAVE_SAFE_MESSAGE}`,
  "invalid-save":
    `Invalid save. This folder is not an FS25 savegame. ${LOCAL_SAVE_SAFE_MESSAGE}`,
  "hash-mismatch": `${VERIFICATION_FAILED_MESSAGE} ${ORIGINAL_SAVE_RECOVERABLE_MESSAGE}`,
};

/** Errors whose copy promises the local save is safe / unchanged. */
export const LOCAL_SAVE_SAFE_ERRORS: ReadonlySet<ErrorKey> = new Set<ErrorKey>([
  "no-internet",
  "upload-failed",
  "download-failed",
  "savegame-not-found",
  "invalid-save",
  "hash-mismatch",
]);

/** Informative empty states (desktop-ui: no active farm, no saves, no requests). */
export const EMPTY_STATES = {
  noFarm: "No active farm. Create or join a farm to get started.",
  noSaves: "No saves in this farm yet. Upload yours to get started.",
  noRequests: "No pending join requests yet. New requests will appear here.",
} as const;

export function errorMessage(key: ErrorKey): string {
  return ERROR_MESSAGES[key];
}

/**
 * Flatten any thrown cause to a message string. Tauri commands reject with the
 * serialized error object (e.g. `{ kind: "secureStore", message }`) rather than
 * an `Error`, so plain objects are unwrapped here instead of rendering as
 * "[object Object]" in the UI.
 */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const obj = cause as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }
  return String(cause);
}

/**
 * True for the fetch/offline failure shapes the browser and Tauri surface
 * (`TypeError: fetch failed`, `Failed to fetch`, `NetworkError`, ...). Accepts
 * a thrown cause or an already-flattened message string.
 */
export function isNetworkError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause);
  return /fetch failed|failed to fetch|networkerror|network request failed|\bload failed\b|err_internet_disconnected/i.test(
    text,
  );
}

/**
 * Map a flattened service error message to catalog copy when it is a known
 * situation (offline, farm not found); otherwise return it unchanged so the
 * service's own copy — which already promises local-save safety where true —
 * is preserved.
 */
export function friendlyErrorMessage(message: string): string {
  if (isNetworkError(message)) return errorMessage("no-internet");
  if (/request failed:\s*404\b|farm not found/i.test(message)) {
    return errorMessage("farm-not-found");
  }
  return message;
}

// --- Toasts ----------------------------------------------------------------
// Tiny store the Toasts host renders; kept here so the DOM-free logic and its
// copy stay in one testable module.

export interface Toast {
  id: number;
  message: string;
  /** Catalog key when the toast came from a known situation. */
  key?: ErrorKey;
}

let nextToastId = 0;
export const toasts = writable<Toast[]>([]);

export function pushToast(message: string, key?: ErrorKey): number {
  const id = ++nextToastId;
  toasts.update((list) => [...list, { id, message, key }]);
  return id;
}

/** Surface a catalog entry as a toast; returns the toast id. */
export function showError(key: ErrorKey): number {
  return pushToast(errorMessage(key), key);
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((toast) => toast.id !== id));
}
