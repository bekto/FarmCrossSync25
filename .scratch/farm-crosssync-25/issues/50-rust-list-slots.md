# 50: Rust — list save slots in an FS25 folder

**What to build:** A `list_slots(root)` command that returns one `SlotInfo` per slot: slots 1..=20 always, plus any extra `savegameN` folder (N > 20) found on disk. Each entry says whether the slot is Used or Empty.

**Priority:** P0

**Blocked by:** none

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- New `src-tauri/src/fs25/slots.rs`; add `pub mod slots;` to `src-tauri/src/fs25/mod.rs`
- `src-tauri/src/fs25/contract.rs`: add the `SlotInfo` struct (camelCase serde, fields exactly as in the design doc), the `list_slots` command, and a table row in the module doc
- `src-tauri/src/lib.rs`: register `fs25::contract::list_slots`
- `src/lib/fs25.ts`: `SlotInfo` interface and `listSlots(root: string): Promise<SlotInfo[]>`

**Steps:**
1. In `slots.rs`: add `pub const FS25_SLOT_COUNT: u32 = 20;` and `pub fn slot_path(root: &Path, slot: u32) -> PathBuf`, which returns `root.join(format!("savegame{slot}"))`.
2. `pub fn list_slots(root: &Path) -> Vec<SlotInfo>`:
   - Start with slots 1..=FS25_SLOT_COUNT.
   - Add every `savegameN` directory in `root` with N > 20. Reuse `discovery::slot_of` for this.
   - For each slot: `used = path.is_dir()`. If used, call `validator::validate` and copy `state`, `map_name` and `last_modified` from its result. If empty, leave those as None.
   - Sort by slot number.
3. If `root` does not exist, the command returns `Err(Fs25Error::Inaccessible)`. A root that exists but has no savegames returns 20 Empty slots.

**Acceptance:**
- [x] Root containing only `savegame1`: returns 20 entries; slot 1 used, 2..=20 empty
- [x] Root containing `savegame1`, `savegame5`, and `savegame23`: returns 21 entries (1..=20 and 23); slots 1, 5, 23 used
- [x] `savegameX`, `logs`, and plain files named `savegame2` are ignored (a file named savegame2 shows slot 2 as Empty)
- [x] Missing root returns `Inaccessible`
- [x] Unit tests in `slots.rs` use temp-dir fixtures, following the pattern in `discovery/linux.rs` tests

**Verify:** `cd FarmCrossSync25-app/src-tauri && cargo test --lib` passes; `cd FarmCrossSync25-app && npm run check` clean.

**Out of scope:** UI; any change to `scan_saves`.

## Work Log
- Done: added `fs25/slots.rs` (`FS25_SLOT_COUNT`, `slot_path`, `list_slots`) + `SlotInfo`/`list_slots` command and TS `SlotInfo`/`listSlots`; cargo test --lib 60 passed, npm run check clean.
