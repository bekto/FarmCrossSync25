// Typed wrappers around the identity Tauri commands.
// Contract source of truth: src-tauri/src/identity.rs.
// The session token never reaches the UI as plaintext state beyond these calls;
// the API client (ticket 40) fetches it via getSessionToken() and attaches it as
// `Authorization: Bearer <token>` on protected requests.

import { invoke } from "@tauri-apps/api/core";

export interface Identity {
  installationId: string;
  displayName: string | null;
  backupLocation: string | null;
  fs25Root: string | null;
}

export type IdentityError =
  | { kind: "inaccessible"; path: string; message: string }
  | { kind: "secureStore"; message: string }
  | { kind: "invalid"; message: string };

export function getIdentity(): Promise<Identity> {
  return invoke("get_identity");
}

export function setDisplayName(name: string): Promise<Identity> {
  return invoke("set_display_name", { name });
}

export function getBackupLocation(): Promise<string | null> {
  return invoke("get_backup_location");
}

export function setBackupLocation(path: string): Promise<Identity> {
  return invoke("set_backup_location", { path });
}

export function getFs25Root(): Promise<string | null> {
  return invoke("get_fs25_root");
}

export function setFs25Root(path: string): Promise<Identity> {
  return invoke("set_fs25_root", { path });
}

export function storeSessionToken(token: string): Promise<void> {
  return invoke("store_session_token", { token });
}

export function getSessionToken(): Promise<string | null> {
  return invoke("get_session_token");
}

export function clearSessionToken(): Promise<void> {
  return invoke("clear_session_token");
}
