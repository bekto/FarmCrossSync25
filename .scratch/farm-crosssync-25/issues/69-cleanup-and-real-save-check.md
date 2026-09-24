# 69: Cleanup of the single-save code + real-save folder-name check

**What to build:** Remove code made dead by the slot rework, and confirm on a real FS25 save that moving a save to a different `savegameN` folder is safe.

**Priority:** P2

**Blocked by:** 61, 63, 66, 68

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Steps:**
1. Delete `src/lib/components/SaveLocation.svelte`. Delete `src/lib/onboarding.ts` and its test **only if** nothing imports them (`grep -rn "onboarding\"\|SaveLocation" src`). If `describeValidation` is still used, move it into `slots.ts` along with its tests.
2. Remove `set_bound_save` (Rust command, `sync_state.rs` method, TS wrapper) if it is unused. Keep `scan_saves`.
3. **Real-save check. This step needs the user, so do not skip or guess it.**
   1. **Stop and ask the user** (use AskUserQuestion, or ask plainly in chat) for one of these:
      - **(a)** the path to a real FS25 savegame folder (e.g. `.../FarmingSimulator2025/savegame1`), or
      - **(b)** the path to a zip of a real save. This can be an archive the user kept from local app testing, or an uploaded object in the local R2 store. Local R2 blobs are raw zip files under `.wrangler/state/v3/r2/farm-crosssync-saves/blobs/`; check them with `file <blob>`, which should report "Zip archive data".
      - Say in the question that the check is read-only and nothing in the save is modified.
   2. For (b), extract it to a scratch dir first: `unzip -q <zip> -d <scratch>/real-save`. Never extract into the user's FS25 folder.
   3. Run `grep -rnoI "savegame[0-9]\+" <folder>`, then `grep -rlI "savegame" <folder>`, and paste the output into the Work Log.
   4. Decide:
      - **No hits**, or hits that are not the save's own folder name (e.g. mod names): record "safe to move between slots" in the Work Log.
      - **A hit on the save's own folder name** (e.g. `savegame1` inside `careerSavegame.xml`): stop. Report the file, line and context to the user. Do not patch any XML.
      - **The user has no real save and no zip:** record "not verified — no real save" in the Work Log and add it to Open questions in `specs/farm-crosssync-25/SPEC.md`.
   5. Delete the scratch extraction when done.

**Acceptance:**
- [x] No unused exports are left from the old flow (check, build and tests are clean)
- [x] The user was asked for a save path or zip, and the grep output (or "not verified") is recorded in the Work Log

**Verify:** `cargo test --lib`, `node --test src/lib/*.test.ts`, `npm run check`, `npm run build` all pass.

## Work Log
- Done: deleted `SaveLocation.svelte`, `onboarding.ts` + test (only SaveLocation imported them; `describeValidation` had no other users, so it was dropped rather than moved). Removed `set_bound_save` (Rust command + registration, `SyncStateStore` method + its test, TS `setBoundSave`, lifecycle-e2e stub); two Rust tests switched to `write`. `scan_saves` kept.
- Real-save check: user gave their FS25 root (a real save directory outside the repo; exact path withheld as personal data) (read-only, no extraction needed).
  - `grep -rnoI "savegame[0-9]\+" savegame1/` → no output
  - `grep -rlI "savegame" savegame1/` → `savegame1/careerSavegame.xml` only; matches are the tags `careerSavegame`, `savegameName`, `isCrossPlatformSavegame`, not the folder name
  - (FS25's own `savegameBackup/savegame1_backupLatest.txt` contains `savegame1`, but it lives outside the save folder and is not packed.)
  - Result: **safe to move between slots.**
- Verify: cargo test --lib 78 pass; node tests 139 pass; check 0 errors; build ok; lifecycle:e2e 41/41.
