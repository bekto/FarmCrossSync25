import { test } from "node:test";
import assert from "node:assert/strict";
import type { SlotBinding, SlotInfo, SyncState, ValidationState } from "./fs25.ts";
import {
  buildSlotCards,
  downloadGate,
  overwriteMessage,
  resolveBoundSave,
  visibleCards,
  type SlotMode,
  type SlotStatus,
} from "./slots.ts";

const ROOT = "/games/FS25";

function info(n: number, overrides: Partial<SlotInfo> = {}): SlotInfo {
  return {
    slot: n,
    path: `${ROOT}/savegame${n}`,
    used: false,
    validation: null,
    mapName: null,
    lastModified: null,
    ...overrides,
  };
}

function used(n: number, validation: ValidationState = "valid"): SlotInfo {
  return info(n, {
    used: true,
    validation,
    mapName: "Riverbend",
    lastModified: "2026-01-01T00:00:00Z",
  });
}

// --- resolveBoundSave ---

function syncState(slot: number | null): SyncState {
  return {
    farmId: "farm-a",
    localHash: null,
    lastUploadedHash: null,
    lastUploadedAt: null,
    lastDownloadedHash: null,
    lastDownloadedAt: null,
    boundSavePath: null,
    slot,
    lastSyncedHash: null,
    lastSyncedAt: null,
    updatedAt: null,
  };
}

test("resolveBoundSave: no state returns null", () => {
  assert.equal(resolveBoundSave(null, [used(1)]), null);
});

test("resolveBoundSave: state without a slot returns null", () => {
  assert.equal(resolveBoundSave(syncState(null), [used(1)]), null);
});

test("resolveBoundSave: a used slot resolves to its SlotInfo", () => {
  const slots = [info(1), used(2)];
  const result = resolveBoundSave(syncState(2), slots);
  assert.equal(result?.slot, 2);
  assert.equal(result?.info.path, `${ROOT}/savegame2`);
});

test("resolveBoundSave: an empty slot returns null", () => {
  assert.equal(resolveBoundSave(syncState(3), [info(3)]), null);
});

const MODES: SlotMode[] = ["create", "join", "download"];

function selectableIn(
  slots: SlotInfo[],
  bindings: SlotBinding[],
  farmId: string | null,
  mode: SlotMode,
): Map<number, boolean> {
  const cards = buildSlotCards({
    slots,
    bindings,
    farmId,
    farmNames: {},
    mode,
  });
  return new Map(cards.map((c) => [c.slot, c.selectable]));
}

function statusIn(
  slots: SlotInfo[],
  bindings: SlotBinding[],
  farmId: string | null,
  mode: SlotMode,
): Map<number, SlotStatus> {
  const cards = buildSlotCards({
    slots,
    bindings,
    farmId,
    farmNames: {},
    mode,
  });
  return new Map(cards.map((c) => [c.slot, c.status]));
}

// --- Selectability matrix: one test per row, all three modes ---

test("matrix: empty is disabled in create, selectable in join/download", () => {
  const slots = [info(1)];
  assert.deepEqual(selectableIn(slots, [], null, "create").get(1), false);
  assert.deepEqual(selectableIn(slots, [], null, "join").get(1), true);
  assert.deepEqual(selectableIn(slots, [], null, "download").get(1), true);
});

test("matrix: used valid/suspicious is selectable in every mode", () => {
  const valid = [used(1, "valid")];
  const suspicious = [used(1, "suspicious")];
  for (const mode of MODES) {
    assert.equal(selectableIn(valid, [], null, mode).get(1), true, mode);
    assert.equal(selectableIn(suspicious, [], null, mode).get(1), true, mode);
  }
});

test("matrix: used invalid/inaccessible is disabled except download", () => {
  const invalid = [used(1, "invalid")];
  const inaccessible = [used(1, "inaccessible")];
  for (const slots of [invalid, inaccessible]) {
    assert.equal(selectableIn(slots, [], null, "create").get(1), false);
    assert.equal(selectableIn(slots, [], null, "join").get(1), false);
    assert.equal(selectableIn(slots, [], null, "download").get(1), true);
    assert.equal(statusIn(slots, [], null, "download").get(1), "unusable");
  }
});

test("matrix: linked to another farm is disabled in every mode", () => {
  const slots = [used(1)];
  const bindings = [{ farmId: "farm-b", slot: 1 }];
  for (const mode of MODES) {
    assert.equal(selectableIn(slots, bindings, "farm-a", mode).get(1), false, mode);
    assert.equal(statusIn(slots, bindings, "farm-a", mode).get(1), "linkedOther");
  }
});

test("matrix: linked to this farm is selectable and preselected in every mode", () => {
  const slots = [used(1)];
  const bindings = [{ farmId: "farm-a", slot: 1 }];
  for (const mode of MODES) {
    const cards = buildSlotCards({
      slots,
      bindings,
      farmId: "farm-a",
      farmNames: { "farm-a": "My Farm" },
      mode,
    });
    assert.equal(cards[0]!.selectable, true, mode);
    assert.equal(cards[0]!.status, "linkedThis");
    assert.equal(cards[0]!.preselected, true, mode);
  }
});

// --- preselected / needsOverwriteConfirm ---

test("preselected is true only for linkedThis", () => {
  const slots = [used(1), used(2), info(3)];
  const bindings = [{ farmId: "farm-a", slot: 1 }];
  const cards = buildSlotCards({
    slots,
    bindings,
    farmId: "farm-a",
    farmNames: {},
    mode: "download",
  });
  for (const card of cards) {
    assert.equal(card.preselected, card.status === "linkedThis");
  }
});

test("needsOverwriteConfirm is download-only for used/unusable not linkedThis", () => {
  const slots = [used(1, "valid"), used(2, "invalid"), info(3), used(4, "valid")];
  const bindings = [{ farmId: "farm-a", slot: 4 }];
  const expected: Record<number, boolean> = { 1: true, 2: true, 3: false, 4: false };
  for (const mode of MODES) {
    const cards = buildSlotCards({
      slots,
      bindings,
      farmId: "farm-a",
      farmNames: {},
      mode,
    });
    for (const card of cards) {
      assert.equal(
        card.needsOverwriteConfirm,
        mode === "download" && expected[card.slot],
        `${mode} slot ${card.slot}`,
      );
    }
  }
});

// --- Subtitles ---

test("subtitles: next free, empty, used, and linked fallback", () => {
  const slots = [
    used(1),
    info(2),
    info(3),
    used(4, "inaccessible"),
    info(5),
  ];
  const bindings = [{ farmId: "farm-zzz", slot: 5 }];
  const cards = buildSlotCards({
    slots,
    bindings,
    farmId: "farm-a",
    farmNames: {},
    mode: "join",
  });
  const bySlot = new Map(cards.map((c) => [c.slot, c]));
  assert.equal(bySlot.get(1)!.subtitle, "Riverbend · 2026-01-01T00:00:00Z");
  assert.equal(bySlot.get(2)!.subtitle, "Empty (next free)");
  assert.equal(bySlot.get(3)!.subtitle, "Empty slot");
  assert.equal(bySlot.get(4)!.subtitle, "Riverbend · 2026-01-01T00:00:00Z");
  assert.equal(bySlot.get(5)!.subtitle, "Linked to another farm");
});

test("linked to another farm uses the known farm name when present", () => {
  const cards = buildSlotCards({
    slots: [used(1)],
    bindings: [{ farmId: "farm-b", slot: 1 }],
    farmId: "farm-a",
    farmNames: { "farm-b": "Bob's Farm" },
    mode: "join",
  });
  assert.equal(cards[0]!.subtitle, "Linked to Bob's Farm");
});

test("title names the slot and path comes from SlotInfo", () => {
  const cards = buildSlotCards({
    slots: [info(7)],
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "join",
  });
  assert.equal(cards[0]!.title, "Slot 7");
  assert.equal(cards[0]!.path, `${ROOT}/savegame7`);
});

// --- visibleCards ---

function twenty(usedSlots: number[]): SlotInfo[] {
  return Array.from({ length: 20 }, (_, i) =>
    usedSlots.includes(i + 1) ? used(i + 1) : info(i + 1),
  );
}

test("visibleCards: 20 slots, 1 and 5 used -> [1,2,5], hidden 17", () => {
  const cards = buildSlotCards({
    slots: twenty([1, 5]),
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "join",
  });
  const { cards: compact, hiddenCount } = visibleCards(cards, false);
  assert.deepEqual(compact.map((c) => c.slot), [1, 2, 5]);
  assert.equal(hiddenCount, 17);
});

test("visibleCards: create mode shows only used slots, no empty", () => {
  const cards = buildSlotCards({
    slots: twenty([1, 5]),
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "create",
  });
  const { cards: compact, hiddenCount } = visibleCards(cards, false);
  assert.deepEqual(compact.map((c) => c.slot), [1, 5]);
  assert.equal(compact.every((c) => c.status !== "empty"), true);
  assert.equal(hiddenCount, 18);
});

test("visibleCards: all 20 empty -> [1]", () => {
  const cards = buildSlotCards({
    slots: twenty([]),
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "join",
  });
  const { cards: compact, hiddenCount } = visibleCards(cards, false);
  assert.deepEqual(compact.map((c) => c.slot), [1]);
  assert.equal(hiddenCount, 19);
});

test("visibleCards: preselected empty slot 7 stays visible", () => {
  const cards = buildSlotCards({
    slots: twenty([]),
    bindings: [{ farmId: "farm-a", slot: 7 }],
    farmId: "farm-a",
    farmNames: {},
    mode: "join",
  });
  const { cards: compact, hiddenCount } = visibleCards(cards, false);
  assert.deepEqual(compact.map((c) => c.slot), [1, 7]);
  assert.equal(hiddenCount, 18);
});

test("visibleCards: expanded returns every card with hiddenCount 0", () => {
  const cards = buildSlotCards({
    slots: twenty([1, 5]),
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "join",
  });
  const { cards: all, hiddenCount } = visibleCards(cards, true);
  assert.equal(all.length, 20);
  assert.equal(hiddenCount, 0);
});

// --- overwriteMessage ---

test("overwriteMessage names the slot and mentions the backup", () => {
  const cards = buildSlotCards({
    slots: [used(3)],
    bindings: [],
    farmId: null,
    farmNames: {},
    mode: "download",
  });
  const message = overwriteMessage(cards[0]!);
  assert.match(message, /Slot 3/);
  assert.match(message, /backup/i);
});

// --- downloadGate ---

test("downloadGate: this farm's bound slot needs the conflict gate", () => {
  const cards = buildSlotCards({
    slots: [used(1)],
    bindings: [{ farmId: "farm-a", slot: 1 }],
    farmId: "farm-a",
    farmNames: {},
    mode: "download",
  });
  assert.equal(cards[0]!.status, "linkedThis");
  assert.equal(downloadGate(cards[0]!), "conflict");
});

test("downloadGate: another used or unusable slot needs the overwrite gate", () => {
  const cards = buildSlotCards({
    slots: [used(1, "valid"), used(2, "invalid")],
    bindings: [],
    farmId: "farm-a",
    farmNames: {},
    mode: "download",
  });
  const bySlot = new Map(cards.map((c) => [c.slot, c]));
  assert.equal(bySlot.get(1)!.status, "used");
  assert.equal(downloadGate(bySlot.get(1)!), "overwrite");
  assert.equal(bySlot.get(2)!.status, "unusable");
  assert.equal(downloadGate(bySlot.get(2)!), "overwrite");
});

test("downloadGate: an empty slot needs no gate", () => {
  const cards = buildSlotCards({
    slots: [info(1)],
    bindings: [],
    farmId: "farm-a",
    farmNames: {},
    mode: "download",
  });
  assert.equal(cards[0]!.status, "empty");
  assert.equal(downloadGate(cards[0]!), "none");
});
