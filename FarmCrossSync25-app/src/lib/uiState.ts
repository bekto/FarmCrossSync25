import { get, writable } from "svelte/store";
import { listSlots, readSyncState } from "./fs25.ts";
import { resolveBoundSave } from "./slots.ts";

export type Destination = "farm" | "settings";

export interface Farm {
  id: string;
  name: string;
}

// Real farm list, loaded from `GET /farms` once the user is signed in. Empty
// until then; the Farm tab shows create/join when no farm is active.
export const farms = writable<Farm[]>([]);

export const activeFarmId = writable<string | null>(null);
export const destination = writable<Destination>("farm");

// The FS25 folder the user picked during onboarding, loaded from `get_fs25_root`
// at startup. While it is null the Farm tab shows the folder onboarding.
export const fs25Root = writable<string | null>(null);

export function setFs25RootStore(path: string) {
  fs25Root.set(path);
}

export function setFarms(list: Farm[]) {
  farms.set(list);
}

// The active farm's bound save, derived from its `SyncState.slot` and the slots
// under the current FS25 folder. Not global: it changes with the active farm.
export interface BoundSave {
  slot: number;
  path: string;
  mapName: string | null;
  /** true when the slot's save validated as suspicious (usable, with warning). */
  warning: boolean;
}

export const boundSave = writable<BoundSave | null>(null);

export function bindSave(save: BoundSave) {
  boundSave.set(save);
}

export function clearBoundSave() {
  boundSave.set(null);
  emptySlot.set(null);
}

// The active farm's slot when it is bound but the slot folder is still Empty
// (e.g. joined into an Empty slot, not downloaded yet). Display only: the
// sidebar shows "Slot N · empty"; boundSave stays null. (ticket 63)
export const emptySlot = writable<number | null>(null);

// Re-derive the bound save from the active farm's slot and the current FS25
// folder's slots. The sequence guard drops a slow read that resolves after a
// newer farm/root change. (ticket 60)
let refreshSeq = 0;

export async function refreshBoundSave(): Promise<void> {
  const seq = ++refreshSeq;
  const farmId = get(activeFarmId);
  const root = get(fs25Root);
  if (!farmId || !root) {
    clearBoundSave();
    return;
  }
  try {
    const state = await readSyncState(farmId);
    const slots = await listSlots(root);
    if (seq !== refreshSeq) return;
    const resolved = resolveBoundSave(state, slots);
    if (resolved) {
      bindSave({
        slot: resolved.slot,
        path: resolved.info.path,
        mapName: resolved.info.mapName,
        warning: resolved.info.validation === "suspicious",
      });
    } else {
      clearBoundSave();
      const info = state?.slot == null ? undefined : slots.find((s) => s.slot === state.slot);
      if (info && !info.used) emptySlot.set(info.slot);
    }
  } catch {
    if (seq === refreshSeq) clearBoundSave();
  }
}

export function setDestination(next: Destination) {
  destination.set(next);
}

export function selectFarm(id: string) {
  activeFarmId.set(id);
}
