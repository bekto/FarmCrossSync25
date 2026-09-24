// FS25 folder onboarding controller (ticket 57).
//
// DOM-, Tauri-, and network-free: root detection, slot listing, the folder
// picker, and persistence are injected, so the flow runs under `node --test`
// with fakes and the Svelte onboarding step stays thin. The user picks the
// folder that *contains* `savegame1`, `savegame2`, …; a `savegameN` pick is
// normalized to its parent. Paths for slots are never built in TS — Rust
// returns them in `SlotInfo.path`.

import type { SlotInfo } from "./fs25.ts";

export const NO_FS25_ROOT_MESSAGE =
  "FS25 folder not found automatically. Use Select Folder to choose it.";

/** Strip a trailing `savegameN` segment from a picked folder. */
export function normalizeRoot(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parent = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (parent < 0) return trimmed;
  if (!/^savegame\d+$/.test(trimmed.slice(parent + 1))) return trimmed;
  return trimmed.slice(0, parent);
}

export interface Fs25RootDeps {
  detectFs25Roots(): Promise<string[]>;
  listSlots(root: string): Promise<SlotInfo[]>;
  pickFolder(): Promise<string | null>;
  setFs25Root(path: string): Promise<unknown>;
}

export interface Fs25RootView {
  candidates: string[];
  root: string | null;
  slots: SlotInfo[];
  busy: boolean;
  error: string | null;
}

export interface Fs25Root {
  snapshot(): Fs25RootView;
  detect(): Promise<void>;
  choose(path: string): Promise<void>;
  selectFolder(): Promise<void>;
  confirm(): Promise<boolean>;
}

export function createFs25Root(deps: Fs25RootDeps): Fs25Root {
  const state: Fs25RootView = {
    candidates: [],
    root: null,
    slots: [],
    busy: false,
    error: null,
  };

  async function choose(path: string): Promise<void> {
    state.busy = true;
    state.error = null;
    try {
      const root = normalizeRoot(path);
      const slots = await deps.listSlots(root);
      state.root = root;
      state.slots = slots;
    } catch (cause) {
      state.root = null;
      state.slots = [];
      state.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      state.busy = false;
    }
  }

  return {
    snapshot: () => ({
      ...state,
      candidates: [...state.candidates],
      slots: [...state.slots],
    }),
    async detect() {
      state.busy = true;
      state.error = null;
      try {
        state.candidates = await deps.detectFs25Roots();
      } catch (cause) {
        state.error = cause instanceof Error ? cause.message : String(cause);
        state.busy = false;
        return;
      }
      state.busy = false;
      if (state.candidates.length === 0) {
        state.root = null;
        state.slots = [];
        state.error = NO_FS25_ROOT_MESSAGE;
        return;
      }
      await choose(state.candidates[0]);
    },
    choose,
    async selectFolder() {
      const path = await deps.pickFolder();
      if (!path) return; // user cancelled the picker: change nothing
      await choose(path);
    },
    async confirm() {
      if (!state.root) return false;
      try {
        await deps.setFs25Root(state.root);
        return true;
      } catch (cause) {
        state.error = cause instanceof Error ? cause.message : String(cause);
        return false;
      }
    },
  };
}
