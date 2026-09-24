# 68: UI — Settings shows the FS25 folder and the farm's slot

**What to build:** In `SettingsScreen.svelte`, replace the "Save location / Change Save" row with two rows: **FS25 folder** (the path plus Change) and **Save slot for this farm** ("Slot N · map", or "No slot", plus Change, which opens the slot picker dialog in mode join).

**Priority:** P1

**Blocked by:** 65, 67

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src/lib/components/SettingsScreen.svelte`:
  - Replace the `onBound` prop with `onSlotsChanged: () => void`, which the shell wires to `refreshBoundSave()`.
  - Slot Change needs cards and the dialog. Add a prop `chooseSlot: (cards) => Promise<SlotCard | null>` and a prop `loadSlotCards: () => Promise<SlotCard[]>`, both supplied by `+page.svelte`.
- `src/routes/+page.svelte`:
  - Pass the new props.
  - After a root change, set the `fs25Root` store.

**Acceptance:**
- [x] Changing the folder updates the sidebar pill (the same slot number under the new root; it may become empty)
- [x] Changing the slot updates the pill and the upload target
- [x] Slots linked to other farms are disabled in the dialog

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: SettingsScreen shows FS25 folder row + "Save slot for this farm" row with picker dialog; `onBound`→`onSlotsChanged`; root change syncs `fs25Root` store; node tests 148 pass, check/build clean; visual check headless only.
