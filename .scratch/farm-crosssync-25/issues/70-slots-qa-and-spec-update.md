# 70: Slots end-to-end QA + spec update

**What to build:** A manual and scripted pass over the whole slot flow using mock folders, plus updates to the specs so they describe slots instead of a single bound save.

**Priority:** P1

**Blocked by:** 69

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**QA setup:**
- Two mock FS25 roots, e.g. `/tmp/fs25-A` containing only `savegame1` and `/tmp/fs25-B` that is empty.
- Copy the 4 marker XMLs from the mock described in PROGRESS.md "Post-completion session".
- Local backend: `wrangler dev` on :8787 with `ENABLE_R2_TEST=true` (see PROGRESS.md).

**Checklist:**
- [ ] A: onboarding picks `/tmp/fs25-A` and the compact view shows slot 1 Used and slot 2 as next free; "Show all 20 slots" shows 1 used + 19 empty
- [ ] A: create a farm with slot 1, then upload
- [ ] B (second installation or second data dir): onboarding shows only Slot 1 as next free; join after expanding and picking slot 2 (Empty)
- [ ] A accepts B. B downloads A's save into slot 2, and `/tmp/fs25-B/savegame2` exists with the same content hash as A's `savegame1`
- [ ] B downloads again into slot 2 (now Used and linked): the conflict gate applies and a backup is created
- [ ] Add `/tmp/fs25-A/savegame14`: it appears in A's compact view without expanding
- [ ] B picks slot 3 for a download: overwrite is not asked (Empty), and afterwards the farm shows Slot 3
- [x] Hash-mismatch or interrupted download into an Empty slot leaves no `savegameN` folder
- [x] `npm run download:e2e`, `npm run reliability:e2e`, and `npm run lifecycle:e2e` still pass (fix the scripts if they broke)

**Spec update:**
- `specs/farm-crosssync-25/systems/fs25-local-save.md` and `desktop-ui.md`: describe the FS25 folder, the slots, the one-slot-per-farm binding, and installing into an empty slot. Summarize from `slots-design.md`.
- `SPEC.md` Primary Workflow: "discover or bind a local save" becomes "pick FS25 folder → choose a slot per farm".

## Work Log
- If a second installation is not practical, B can be simulated by pointing the identity and sync-state dirs elsewhere. Record how in this Work Log.
- Done (scripted): download:e2e 21/21, reliability:e2e 28/28, lifecycle:e2e 41/41; no script fixes needed. Empty-slot hash mismatch covered by Rust `slots::tests::hash_mismatch_on_empty_slot_leaves_nothing`.
- Spec updated: `systems/fs25-local-save.md`, `systems/desktop-ui.md`, `SPEC.md` Primary Workflow now describe the FS25 folder, slots, one slot per farm, and installing into an Empty slot.
- NOT run: the manual two-installation GUI walkthrough (the other unticked items above). This needs a person to click through the app with two data dirs and the local backend; left unticked.
