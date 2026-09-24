# 67: TS — Settings logic for FS25 folder and farm slot

**What to build:** Replace `changeSave` in `src/lib/settings.ts` with two actions: `changeFs25Root()` (pick a folder, normalize it, list its slots, persist it) and `changeSlot(farmId, slot)`, which calls `setFarmSlot`. `load()` exposes `fs25Root` and `slot` in the view.

**Priority:** P1

**Blocked by:** 52, 54, 57

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Changes in `settings.ts`:**
- Deps:
  - Remove `setBoundSave`, `validateSave`, and `readMetadata` if they become unused.
  - Add `getFs25Root`, `setFs25Root`, `listSlots`, and `setFarmSlot`.
- View: replace `savePath` with `fs25Root: string | null` and `slot: number | null`, the latter taken from `sync?.slot`.
- `changeFs25Root()`:
  - Pick a folder and `normalizeRoot` it (import from fs25Root.ts).
  - Call `listSlots`. If it errors, show the error and leave the old root.
  - `setFs25Root`, message "FS25 folder updated." Return the new root or null.
- `changeSlot(farmId, slot)`: `setFarmSlot(farmId, fs25Root, slot)`, message "Save slot updated."
- Update `settings.test.ts`: remove the changeSave tests, and add tests for both new actions (success, cancelled picker, listSlots error).

**Acceptance:**
- [x] A cancelled picker changes nothing
- [x] Changing the root does not change any farm's slot number
- [x] `grep -n changeSave src` returns nothing when the ticket is finished (fix the SettingsScreen call site minimally; ticket 68 does the UI)

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check` — all pass, 0 errors.

## Work Log
- Done: `settings.ts` now exposes `changeFs25Root()`/`changeSlot()` and `fs25Root`/`slot` in the view; `changeSave` removed; SettingsScreen call site minimally updated; node tests 148 pass, check clean.
