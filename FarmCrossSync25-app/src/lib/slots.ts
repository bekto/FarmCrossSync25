// Slot view model (ticket 56).
//
// Pure: no Svelte, Tauri, or DOM imports. Turns the Rust `SlotInfo[]` plus the
// farm bindings into the cards the UI renders, following the selectability
// matrix in `.scratch/farm-crosssync-25/slots-design.md` exactly. Paths are
// never built here — `SlotInfo.path` comes from Rust.

import type { SlotBinding, SlotInfo, SyncState } from "./fs25.ts";

export type SlotMode = "create" | "join" | "download";

export type SlotStatus =
  | "empty"
  | "used"
  | "unusable"
  | "linkedOther"
  | "linkedThis";

export interface SlotCard {
  slot: number;
  path: string;
  title: string;
  subtitle: string;
  status: SlotStatus;
  selectable: boolean;
  needsOverwriteConfirm: boolean;
  preselected: boolean;
}

export interface SlotCardInput {
  slots: SlotInfo[];
  bindings: SlotBinding[];
  farmId: string | null;
  farmNames: Record<string, string>;
  mode: SlotMode;
}

/**
 * The farm's bound save comes from its sync-state slot: find that slot in the
 * folder's slot list. Null when the farm has no slot, the slot is not listed,
 * or the slot is Empty (ticket 60).
 */
export function resolveBoundSave(
  state: SyncState | null,
  slots: SlotInfo[],
): { slot: number; info: SlotInfo } | null {
  if (state?.slot == null) return null;
  const info = slots.find((s) => s.slot === state.slot);
  if (!info || !info.used) return null;
  return { slot: state.slot, info };
}

const SELECTABLE: Record<SlotStatus, Record<SlotMode, boolean>> = {
  empty: { create: false, join: true, download: true },
  used: { create: true, join: true, download: true },
  unusable: { create: false, join: false, download: true },
  linkedOther: { create: false, join: false, download: false },
  linkedThis: { create: true, join: true, download: true },
};

function statusOf(
  slot: SlotInfo,
  binding: SlotBinding | undefined,
  farmId: string | null,
): SlotStatus {
  if (binding) return binding.farmId === farmId ? "linkedThis" : "linkedOther";
  if (!slot.used) return "empty";
  if (slot.validation === "invalid" || slot.validation === "inaccessible") {
    return "unusable";
  }
  return "used";
}

function subtitleFor(
  slot: SlotInfo,
  status: SlotStatus,
  farmName: string | null,
  nextFree: boolean,
): string {
  switch (status) {
    case "linkedThis":
      return `Linked to ${farmName ?? "this farm"}`;
    case "linkedOther":
      return `Linked to ${farmName ?? "another farm"}`;
    case "empty":
      return nextFree ? "Empty (next free)" : "Empty slot";
    default: {
      const map = slot.mapName ?? "Unknown map";
      return slot.lastModified ? `${map} · ${slot.lastModified}` : map;
    }
  }
}

export function buildSlotCards(input: SlotCardInput): SlotCard[] {
  const { slots, bindings, farmId, farmNames, mode } = input;
  const bindingBySlot = new Map(bindings.map((b) => [b.slot, b]));

  const staged = slots.map((slot) => {
    const binding = bindingBySlot.get(slot.slot);
    const status = statusOf(slot, binding, farmId);
    const selectable = SELECTABLE[status][mode];
    const ownerId = binding ? binding.farmId : farmId;
    return {
      slot,
      status,
      selectable,
      farmName: ownerId ? (farmNames[ownerId] ?? null) : null,
    };
  });

  const nextFree = staged
    .filter((s) => s.status === "empty" && s.selectable)
    .reduce<number | null>(
      (min, s) => (min === null || s.slot.slot < min ? s.slot.slot : min),
      null,
    );

  return staged
    .sort((a, b) => a.slot.slot - b.slot.slot)
    .map(({ slot, status, selectable, farmName }) => ({
      slot: slot.slot,
      path: slot.path,
      title: `Slot ${slot.slot}`,
      subtitle: subtitleFor(slot, status, farmName, slot.slot === nextFree),
      status,
      selectable,
      needsOverwriteConfirm:
        mode === "download" &&
        status !== "linkedThis" &&
        (status === "used" || status === "unusable"),
      preselected: status === "linkedThis",
    }));
}

/** Confirmation copy for replacing a save that already occupies a slot. */
export function overwriteMessage(card: SlotCard): string {
  return `Slot ${card.slot} already contains a save. Overwriting it will create a backup first.`;
}

/**
 * Which gate a download into `card` needs (ticket 66). "conflict" only when the
 * target is this farm's bound slot; any other used/unusable slot needs the
 * overwrite confirmation; an empty slot needs neither (see "When the conflict
 * gate runs" in the design doc).
 */
export function downloadGate(card: SlotCard): "conflict" | "overwrite" | "none" {
  if (card.status === "linkedThis") return "conflict";
  if (card.status === "empty") return "none";
  return "overwrite";
}

/**
 * "Slot display" from the design doc. Expanded shows every card. Compact shows
 * every non-empty card, the lowest-numbered selectable empty card ("next
 * free"), and the preselected card; `hiddenCount` is the rest.
 */
export function visibleCards(
  cards: SlotCard[],
  expanded: boolean,
): { cards: SlotCard[]; hiddenCount: number } {
  if (expanded) return { cards: [...cards], hiddenCount: 0 };
  const nextFree = cards.find((c) => c.status === "empty" && c.selectable);
  const visible = cards.filter(
    (c) => c.status !== "empty" || c === nextFree || c.preselected,
  );
  return { cards: visible, hiddenCount: cards.length - visible.length };
}
