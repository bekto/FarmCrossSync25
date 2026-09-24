# 60: UI shell — the bound save comes from the active farm's slot

**What to build:** `boundSave` stops being a single global chosen at onboarding. Whenever the active farm or `fs25Root` changes, the shell loads that farm's `SyncState.slot`, finds the matching `SlotInfo` via `listSlots`, and sets `boundSave`. It is null when there is no slot or the slot is Empty.

**Priority:** P0

**Blocked by:** 54, 59

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- New pure helper in `src/lib/slots.ts`: `resolveBoundSave(state: SyncState | null, slots: SlotInfo[]): { slot: number; info: SlotInfo } | null`, with tests in `slots.test.ts`
- `src/lib/uiState.ts`: change `BoundSave` to `{ slot: number; path: string; mapName: string | null; warning: boolean }` and add `refreshBoundSave()`, called by the shell
- `src/routes/+page.svelte`:
  - Add an `$effect` on `$activeFarmId` and `$fs25Root`: `readSyncState`, then `listSlots`, then `resolveBoundSave`, then `bindSave` or `clearBoundSave`.
  - **Delete** the `$effect` that calls `setBoundSave(farmId, $boundSave.path)`.
  - Delete the `onBound` / SaveLocation wiring.
  - The effects that were gated on `$boundSave` (fetchCurrentUserId, farmSetup.load) are now gated on `$fs25Root`.
  - The render gate becomes: `!$fs25Root` shows Fs25FolderSetup, then `$activeFarmId` shows FarmScreen, else FarmSetup.
  - The upload/download dock shows when `$activeFarmId` is set.
  - Sidebar pill: "Slot N · <map>" when bound, otherwise "No slot linked".
- `SettingsScreen`'s `onBound` prop: have it call `refreshBoundSave()` for now (ticket 68 replaces it)

**Acceptance:**
- [x] Switching farms updates the sidebar pill and the FarmScreen `savePath`
- [x] A farm with no slot passes `savePath={null}` to FarmScreen (upload is disabled, as it already is)
- [x] No code writes `setBoundSave` from a global value any more (`grep -n setBoundSave src/routes` returns nothing)
- [x] resolveBoundSave tests: no state, slot null, slot present and used, slot present but empty (returns null)

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: added `resolveBoundSave` + `refreshBoundSave`; `boundSave` derived from active farm's slot/fs25Root; removed global setBoundSave wiring; node tests 132 pass, check/build clean; visual check headless only.
