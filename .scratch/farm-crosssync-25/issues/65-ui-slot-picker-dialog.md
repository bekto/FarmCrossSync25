# 65: UI — slot picker dialog for downloads

**What to build:** A modal `SlotPickerDialog.svelte` wrapping SlotPicker. It has a title, a confirm button "Download to Slot N", and Cancel. The `+page.svelte` shell opens it through a promise, the same way `confirm()` and `chooseConflict()` already work.

**Priority:** P0

**Blocked by:** 58

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- New `src/lib/components/SlotPickerDialog.svelte`:
  - Props: `title`, `cards: SlotCard[]`, `onResolve(card: SlotCard | null)`.
  - Copy the modal markup, focus handling and Escape behaviour from `ConfirmDialog.svelte`.
  - The initial selection is the `preselected` card, if any. The confirm button stays disabled until a card is selected.
- `src/routes/+page.svelte`: add `chooseSlot(title, cards): Promise<SlotCard | null>` and a `slotRequest` state, mirroring `confirmRequest`. Render the dialog when it is set. **Do not** wire it into downloads yet (ticket 66).

**Acceptance:**
- [x] Escape or Cancel resolves null
- [x] The preselected card is highlighted on open
- [x] Disabled cards cannot be chosen

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: added modal `SlotPickerDialog.svelte` (preselected, Escape/Cancel -> null) and `chooseSlot`/`slotRequest` in `+page.svelte` (not yet wired to downloads); node tests 128 pass, check/build clean; visual check headless only.
