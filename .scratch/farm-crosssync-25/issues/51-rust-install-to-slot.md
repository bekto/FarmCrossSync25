# 51: Rust — install a staged save into a slot (empty or used)

**What to build:** An `install_save_to_slot` command that puts an already-extracted save into `<root>/savegameN`. For an Empty slot it creates the folder safely. For a Used slot it delegates to the existing transactional `replace::replace`.

**Priority:** P0

**Blocked by:** 50

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src-tauri/src/fs25/slots.rs`: `pub fn install_to_slot(root, slot, staged, expected_hash: Option<&str>, backup_root: Option<&Path>) -> Result<InstallResult, Fs25Error>`
- `contract.rs`: `InstallResult` struct (as in the design doc), `install_save_to_slot` command, doc table row
- `lib.rs`: register the command
- `src/lib/fs25.ts`: `InstallResult` and `installSaveToSlot(root, slot, stagedPath, expectedHash?, backupDir?)`

**Steps:**
1. Reject `slot == 0` and a missing `root` directory with `Fs25Error::Internal` or `Inaccessible`.
2. Compute `target = slot_path(root, slot)`.
3. If `target` exists: call `replace::replace(target, staged, expected_hash, backup_root)` and map the result to `InstallResult { was_empty: false, backup_path, ... }`.
4. If `target` does not exist:
   1. Hash `staged` and compare it to `expected_hash`. On mismatch, return an error.
   2. Copy `staged` into a unique sibling temp dir in `root`. Reuse `backup::copy_dir`. Copy the temp-dir naming and guard pattern from `replace.rs`.
   3. Re-hash the copy.
   4. `std::fs::rename(temp, target)`.
   5. Return `was_empty: true, backup_path: None`.
   - On any error, the temp dir is removed and `target` must not exist.

**Acceptance:**
- [x] Empty slot: `savegame2` is created with the same content hash as staged. No backup is made.
- [x] Used slot: the content is replaced, a backup is made, and `was_empty == false`
- [x] Hash mismatch on an empty slot: no `savegame2` folder and no temp leftovers in `root`
- [x] Hash mismatch on a used slot: the original is untouched (covered by replace.rs; add one test here to prove the delegation)
- [x] Slot 0 is rejected

**Verify:** `cd FarmCrossSync25-app/src-tauri && cargo test --lib` passes; `cd FarmCrossSync25-app && npm run check` clean.

**Out of scope:** download flow changes (ticket 64).

## Work Log
- Done: added `slots::install_to_slot` + `InstallResult`/`install_save_to_slot` command and TS binding; reused `replace::unique_sibling`/`TempDir` (made pub(crate)) instead of duplicating; cargo test --lib 73 passed, npm run check clean.
