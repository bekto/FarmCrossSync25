# 61: UI — Farm screen asks for a slot when the farm has none

**What to build:** When the active farm has no slot bound, FarmScreen shows a "Choose a save slot for this farm" card with a SlotPicker (`mode: "join"`). Picking a slot calls `setFarmSlot` and refreshes `boundSave`. This covers farms joined before this feature and reinstalls.

**Priority:** P1

**Blocked by:** 58, 60

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src/lib/components/FarmScreen.svelte`: new optional props `slotCards: SlotCard[] | null` and `onChooseSlot: (card) => void`. When `savePath` is null and `slotCards` is set, render the card above the "Your save" section.
- `src/routes/+page.svelte`: when the active farm has no slot, load `listSlots($fs25Root)` and `listSlotBindings()`, then build the cards with `buildSlotCards` (`farmNames` comes from the `farms` store). In `onChooseSlot`, call `setFarmSlot(farmId, $fs25Root, card.slot)` and then `refreshBoundSave()`.
- Copy: "Pick the FS25 slot this farm uses. Choose an empty slot if you will download a friend's save first."

**Acceptance:**
- [x] A farm without a slot shows the picker. After choosing, the picker disappears and the pill shows the slot.
- [x] If an Empty slot is chosen, the upload button stays disabled and shows the hint "Download a save into this slot first". Downloading stays available.
- [x] Slots linked to other farms are disabled

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: FarmScreen shows "Choose a save slot for this farm" (join-mode SlotPicker) when `SyncState.slot == null`; choosing calls `setFarmSlot` + `refreshBoundSave`; empty-slot upload hint; node tests 143 pass, check/build clean; visual check headless only. Assumption: "no slot" keyed on `SyncState.slot`, not `boundSave` (also null for Empty).
