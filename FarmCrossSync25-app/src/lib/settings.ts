// Settings view logic (ticket 37).
//
// DOM-, Tauri-, and network-free: identity, sync state, folder picking,
// backup location, farm detail, leaving, and confirmation are all injected, so
// the flow runs under `node --test` with fakes and the Svelte component stays
// thin. Spec (desktop-ui): "Settings: player name, FS25 folder (picker + path),
// farm slot, backup location, farm ID, farm code, Leave Farm."
// farms-and-membership: leaving deletes the player's cloud save; local saves are
// untouched.
//
// Backup location persistence: stored as an extra field in the existing
// identity store (`identity.json`) via `get_backup_location` /
// `set_backup_location`, rather than a new subsystem — the same local store
// already owns per-installation settings, and the field is omitted until set so
// older identity files stay compatible.

import type { SlotInfo, SyncState } from "./fs25.ts";
import type { Identity } from "./identity.ts";
import type { FarmDetail } from "./farmScreen.ts";
import { describeError } from "./errors.ts";
import { normalizeRoot } from "./fs25Root.ts";

export type ConfirmFn = (
  message: string,
  confirmLabel?: string,
) => boolean | Promise<boolean>;

export interface SettingsView {
  displayName: string;
  fs25Root: string | null;
  slot: number | null;
  backupLocation: string | null;
  farm: FarmDetail | null;
  loading: boolean;
  error: string | null;
  message: string | null;
}

export interface SettingsDeps {
  getIdentity(): Promise<Identity>;
  setDisplayName(name: string): Promise<Identity>;
  /** Persist the name in the cloud via `PATCH /me` (ticket 84). */
  updateCloudDisplayName(name: string): Promise<void>;
  getSyncState(farmId: string): Promise<SyncState | null>;
  getFs25Root(): Promise<string | null>;
  setFs25Root(path: string): Promise<unknown>;
  listSlots(root: string): Promise<SlotInfo[]>;
  setFarmSlot(farmId: string, root: string, slot: number): Promise<SyncState>;
  pickFolder(): Promise<string | null>;
  getBackupLocation(): Promise<string | null>;
  setBackupLocation(path: string): Promise<unknown>;
  fetchFarm(farmId: string): Promise<FarmDetail>;
  leaveFarm(farmId: string): Promise<void>;
  /**
   * Sign out (ticket 83): revoke the session, clear the stored token and the
   * session cache, and return to the registration prompt. Safe when offline.
   */
  signOut(): Promise<void>;
  /** Production wires the confirmation dialog; injected so tests fake it. */
  confirm: ConfirmFn;
}

export interface SettingsScreen {
  /** Svelte store contract: `$settings` stays in sync with the view model. */
  subscribe(run: (view: SettingsView) => void): () => void;
  snapshot(): SettingsView;
  /** Load identity, FS25 folder, farm slot, backup location, and farm detail. */
  load(farmId: string): Promise<void>;
  /**
   * Edit the display name: writes the local setting and syncs the cloud name
   * (`PATCH /me`) as separate steps. False when blank, over-long, or either
   * step failed; on a cloud-only failure the local name has still changed and
   * the error says so (local and cloud diverge, ticket 84).
   */
  saveDisplayName(name: string): Promise<boolean>;
  /** Pick + persist a new FS25 folder; returns the new root, or null. */
  changeFs25Root(): Promise<string | null>;
  /** Bind the farm to a slot under the current FS25 folder. */
  changeSlot(farmId: string, slot: number): Promise<boolean>;
  /** Pick + persist a new backup directory; false when cancelled or failed. */
  changeBackupLocation(): Promise<boolean>;
  /** Confirm, then leave. Local saves are untouched. */
  leave(farmId: string): Promise<boolean>;
  /** Confirm, then sign out of the cloud on this device (ticket 83). */
  signOut(): Promise<boolean>;
}

export function leaveConfirmation(farmName: string): string {
  return `Leave ${farmName}? Your cloud save in this farm will be deleted. Your local save is untouched.`;
}

export function signOutConfirmation(): string {
  return "Sign out? This device will need to register again to use the cloud. Your local saves are untouched.";
}

/**
 * The backend's display-name cap (`PATCH /me`): names are trimmed, must be
 * 1..=64 characters, and are never silently truncated.
 */
export const MAX_DISPLAY_NAME_LENGTH = 64;

/**
 * Copy for the local/cloud split after a failed `PATCH /me` (ticket 84): the
 * local write succeeded, so the device and the cloud now hold different names.
 */
export function cloudUpdateFailedMessage(reason: string): string {
  return `Display name updated on this device only; the cloud name did not change (${reason}). Farm members still see the old name.`;
}

/** Success copy: only reached when both the local write and `PATCH /me` landed. */
export const DISPLAY_NAME_SYNCED_MESSAGE =
  "Display name updated and synced to the cloud.";

const describe = describeError;

export function createSettings(deps: SettingsDeps): SettingsScreen {
  const state: SettingsView = {
    displayName: "",
    fs25Root: null,
    slot: null,
    backupLocation: null,
    farm: null,
    loading: false,
    error: null,
    message: null,
  };
  const listeners = new Set<(view: SettingsView) => void>();
  let currentFarmId: string | null = null;

  function snapshot(): SettingsView {
    return { ...state, farm: state.farm ? { ...state.farm } : null };
  }

  function emit() {
    const view = snapshot();
    for (const run of listeners) run(view);
  }

  function fail(cause: unknown) {
    state.error = describe(cause);
    emit();
  }

  return {
    subscribe(run) {
      run(snapshot());
      listeners.add(run);
      return () => listeners.delete(run);
    },
    snapshot,
    async load(farmId) {
      currentFarmId = farmId;
      state.loading = true;
      state.error = null;
      emit();
      try {
        const [identity, sync, backup, farm, root] = await Promise.all([
          deps.getIdentity(),
          deps.getSyncState(farmId),
          deps.getBackupLocation(),
          deps.fetchFarm(farmId),
          deps.getFs25Root(),
        ]);
        // Ignore a response that arrived after the user switched farms.
        if (currentFarmId !== farmId) return;
        state.displayName = identity.displayName ?? "";
        state.fs25Root = root;
        state.slot = sync?.slot ?? null;
        state.backupLocation = backup;
        state.farm = farm;
      } catch (cause) {
        if (currentFarmId === farmId) fail(cause);
      } finally {
        if (currentFarmId === farmId) {
          state.loading = false;
          emit();
        }
      }
    },
    async saveDisplayName(name) {
      const trimmed = name.trim();
      if (!trimmed) {
        state.error = "Display name must not be empty.";
        emit();
        return false;
      }
      if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
        // The backend rejects rather than truncates; mirror it up front so the
        // local and cloud rules stay identical.
        state.error = `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
        emit();
        return false;
      }
      state.error = null;
      // Local write first: the device name is the user's immediate setting and
      // must land even when the cloud is unreachable (ticket 84).
      let identity: Identity;
      try {
        identity = await deps.setDisplayName(trimmed);
      } catch (cause) {
        fail(cause);
        return false;
      }
      state.displayName = identity.displayName ?? trimmed;
      emit();
      try {
        await deps.updateCloudDisplayName(trimmed);
        state.message = DISPLAY_NAME_SYNCED_MESSAGE;
        emit();
        return true;
      } catch (cause) {
        // Local-only success: say plainly that the two now diverge instead of
        // an ambiguous "updated" (the cloud name is what farm members see).
        state.message = null;
        state.error = cloudUpdateFailedMessage(describe(cause));
        emit();
        return false;
      }
    },
    async changeFs25Root() {
      state.error = null;
      try {
        const picked = await deps.pickFolder();
        if (!picked) return null; // cancelled picker: change nothing
        const root = normalizeRoot(picked);
        await deps.listSlots(root);
        await deps.setFs25Root(root);
        state.error = null;
        state.fs25Root = root;
        state.message = "FS25 folder updated.";
        emit();
        return root;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },
    async changeSlot(farmId, slot) {
      state.error = null;
      if (!state.fs25Root) {
        state.error = "Select an FS25 folder first.";
        emit();
        return false;
      }
      try {
        await deps.setFarmSlot(farmId, state.fs25Root, slot);
        state.slot = slot;
        state.message = "Save slot updated.";
        emit();
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    async changeBackupLocation() {
      state.error = null;
      try {
        const path = await deps.pickFolder();
        if (!path) return false;
        await deps.setBackupLocation(path);
        state.error = null;
        state.backupLocation = path;
        state.message = "Backup location updated.";
        emit();
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    async leave(farmId) {
      const name = state.farm?.name ?? "this farm";
      const proceed = await deps.confirm(leaveConfirmation(name), "Leave Farm");
      if (!proceed) return false;
      state.error = null;
      try {
        await deps.leaveFarm(farmId);
        state.message = `Left ${name}. Your local save is untouched.`;
        emit();
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    async signOut() {
      const proceed = await deps.confirm(signOutConfirmation(), "Sign out");
      if (!proceed) return false;
      state.error = null;
      try {
        await deps.signOut();
        state.message = "Signed out.";
        emit();
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
  };
}
