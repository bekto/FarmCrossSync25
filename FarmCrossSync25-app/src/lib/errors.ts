// Error catalog, empty-state copy, and toast plumbing (ticket 39).
//
// Only situations the UI actually renders get an entry here (`no-internet`,
// `farm-not-found`); upload/download/validation failures surface the copy
// owned by their flows (upload.ts / download.ts), which already carries the
// local-save-safety promise (desktop-ui edge case: "Failed cloud operations
// always state that local data is safe"). The catalog entries nothing
// rendered were removed with ticket 88.
// DOM-, Tauri-, and network-free, so it runs under `node --test`; the Svelte
// components stay thin and just render this text.

import { writable } from "svelte/store";
import { slotConflictMessage } from "./fs25.ts";
import { NEED_INTERNET_MESSAGE } from "./session.ts";

/** Every catalog situation with a real renderer. */
export type ErrorKey = "no-internet" | "farm-not-found";

/**
 * User-facing copy per situation. The offline entry is the spec's exact
 * wording — "Unable to connect to cloud. Your local save has not been changed."
 * — which itself carries the local-save promise.
 */
export const ERROR_MESSAGES: Record<ErrorKey, string> = {
  "no-internet": NEED_INTERNET_MESSAGE,
  "farm-not-found": "Farm not found. Check the farm code and try again.",
};

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
 * "[object Object]" in the UI. Structured FS25 errors get their clear
 * user-facing copy (ticket 80) rather than the raw JSON.
 */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const obj = cause as Record<string, unknown>;
    if (obj.kind === "slotConflict" && typeof obj.slot === "number") {
      return slotConflictMessage(obj.slot);
    }
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
  // The API client surfaces the server error string (`{ "error": "..." }`).
  if (/farm not found/i.test(message)) {
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
