# 66: UI — wire slot choice into Download

**What to build:** Clicking Download on a friend's save opens the slot picker (mode download). The chosen slot drives the confirmation, the conflict gate, and `runDownload`, following the design doc's "When the conflict gate runs" rule.

**Priority:** P0

**Blocked by:** 60, 64, 65

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:** `src/routes/+page.svelte` (the `runDownload` handler passed to `createFarmScreen`), plus `src/lib/download.ts` or `slots.ts` for the helper below. Put the decision logic in a pure helper with tests, not inline in Svelte:
```ts
// src/lib/slots.ts
export function downloadGate(card: SlotCard): "conflict" | "overwrite" | "none";
// linkedThis & used -> "conflict"; used/unusable & not linkedThis -> "overwrite"; empty -> "none"
```

**Handler sequence:**
1. `listSlots($fs25Root)` and `listSlotBindings()`, then `buildSlotCards(mode "download")`
2. `chooseSlot("Choose a slot for <player>'s save", cards)`. Null means stop, and nothing changes.
3. Gate:
   - `"overwrite"`: `confirm(overwriteMessage(card), "Overwrite Slot N")`. False means stop.
   - `"conflict"`: use `runDownloadWithConflict` with `localHash` from `readMetadata(card.path)`.
   - `"none"` / `"overwrite"`: call `runDownload` directly.
4. Input: `{ fs25Root, slot: card.slot, slotPath: card.path, slotUsed: card.status !== "empty" }`
5. On success: `refreshBoundSave()`

The FarmScreen download button must work even when `savePath` is null (a farm with no slot yet). Update `FarmScreen.svelte` and `farmScreen.ts` so `downloadSave` no longer requires `savePath`. Adjust `farmScreen.test.ts`.

**Acceptance:**
- [x] downloadGate unit tests cover all 3 outcomes
- [x] A farm with no slot can download straight into an Empty slot, and afterwards the farm is bound to it
- [x] Downloading into a different Used slot asks for overwrite, not conflict, and the farm is rebound to that slot
- [x] Cancelling the picker or the confirmation changes nothing on disk

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: added `slots::downloadGate`; download handler now opens SlotPicker(mode download), gates conflict/overwrite/none, runs `runDownload` with chosen slot and `refreshBoundSave()`; `farmScreen.downloadSave` no longer requires `savePath`; node tests 143 pass, check/build clean; visual check headless only.
