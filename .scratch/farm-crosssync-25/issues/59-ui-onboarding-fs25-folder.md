# 59: UI — onboarding picks the FS25 folder, not a single save

**What to build:** Replace the first-run `SaveLocation` step with a new `Fs25FolderSetup.svelte`. It auto-detects the FS25 folder, offers Select Folder, previews the slots read-only with SlotPicker, and on Continue persists the root. Add an `fs25Root` store that loads at startup, so onboarding shows only once.

**Priority:** P0

**Blocked by:** 57, 58

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- New `src/lib/components/Fs25FolderSetup.svelte`. It uses `createFs25Root` (ticket 57) and `buildSlotCards` with `mode: "join"`, `farmId: null`, empty bindings (preview only). Keep the header layout of `SaveLocation.svelte` (step label, h1 "FS25 Save Folder", muted text "Pick the folder that holds your savegame1, savegame2, … folders.").
- `src/lib/uiState.ts`: `export const fs25Root = writable<string | null>(null)` and `setFs25RootStore(path)`
- `src/routes/+page.svelte`:
  - On mount, call `getFs25Root()` and put the result into the store.
  - Replace `{#if !$boundSave} <SaveLocation …/>` with `{#if !$fs25Root} <Fs25FolderSetup onDone={(root) => setFs25RootStore(root)} />`.
  - While loading, render nothing, so the onboarding screen does not flash.

**Acceptance:**
- [x] First run: the detected folder is shown with the compact slot view (used slots + next free). Select Folder works. Continue is disabled until slots have loaded.
- [x] After Continue, the app moves on to farm setup. After a restart, onboarding is skipped.
- [x] Picking `.../savegame1` resolves to its parent (the normalizeRoot behaviour is visible)
- [x] A folder with no savegames shows only "Slot 1 · Empty (next free)" and can still continue (the user may want to join a farm)

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.
Note: after this ticket, the Farm tab stops at FarmSetup/FarmScreen with `boundSave` possibly null. Ticket 60 fixes that. Leave `boundSave` alone here except for the gate.

## Work Log
- Done: added `Fs25FolderSetup.svelte` + `fs25Root` store; `+page.svelte` loads root on mount and gates onboarding on it; removed SaveLocation import/onBound wiring; node tests 128 pass, check/build/audit:styles clean; visual check headless only.
