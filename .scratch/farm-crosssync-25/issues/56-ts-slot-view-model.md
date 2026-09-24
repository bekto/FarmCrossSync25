# 56: TS — slot view model (selectability rules)

**What to build:** A pure module `src/lib/slots.ts` that turns `SlotInfo[]` plus bindings into the cards the UI renders. It follows the selectability matrix in the design doc exactly.

**Priority:** P0

**Blocked by:** 50, 55

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:** new `src/lib/slots.ts` and `src/lib/slots.test.ts`. No Svelte, Tauri, or DOM imports. Use type-only imports from `./fs25.ts`.

**API:**
```ts
export type SlotMode = "create" | "join" | "download";
export type SlotStatus = "empty" | "used" | "unusable" | "linkedOther" | "linkedThis";
export interface SlotCard {
  slot: number; path: string; title: string;      // "Slot 2"
  subtitle: string;                               // map name + last modified, "Empty slot", or "Linked to <farm>"
  status: SlotStatus; selectable: boolean;
  needsOverwriteConfirm: boolean;                 // download mode only
  preselected: boolean;
}
export function buildSlotCards(input: {
  slots: SlotInfo[]; bindings: SlotBinding[]; farmId: string | null;
  farmNames: Record<string, string>; mode: SlotMode;
}): SlotCard[];
export function overwriteMessage(card: SlotCard): string; // names the slot and says a backup is made first
export function visibleCards(cards: SlotCard[], expanded: boolean): { cards: SlotCard[]; hiddenCount: number };
```
- `visibleCards` implements "Slot display" in the design doc. Expanded returns every card with `hiddenCount: 0`. Compact returns every card whose status is not "empty", plus the lowest-numbered **selectable** empty card, plus the preselected card. `hiddenCount` is the number left out.
- The next-free empty card's subtitle is "Empty (next free)". Other empty cards say "Empty slot".
- "unusable" means a used slot whose validation is invalid or inaccessible.
- "linkedThis" means the binding's farmId equals `farmId`.

**Acceptance:**
- [x] One test per row of the matrix, for each of the 3 modes
- [x] `preselected` is true only for linkedThis
- [x] `needsOverwriteConfirm` is true only in download mode for used/unusable slots that are not linkedThis
- [x] visibleCards: 20 slots with 1 and 5 used gives compact = [1, 2, 5] (2 is next free), hiddenCount 17
- [x] visibleCards in create mode (empty not selectable): compact shows only used slots, no empty one
- [x] visibleCards: all 20 empty gives compact = [1]; a preselected empty slot 7 stays visible
- [x] Linked to another farm with an unknown name falls back to "Linked to another farm"

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check` — all pass, 0 errors.

## Work Log
- Done: added pure `slots.ts` view model (buildSlotCards/overwriteMessage/visibleCards) + tests; node tests 128 pass, check clean.
