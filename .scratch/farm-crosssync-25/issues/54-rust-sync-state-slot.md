# 54: Rust — bind a farm to a slot in sync state

**What to build:** Add `slot` to `SyncState` and a `set_farm_slot(farmId, root, slot)` command that records the slot and keeps `bound_save_path` equal to `<root>/savegame<slot>`.

**Priority:** P0

**Blocked by:** 50

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `contract.rs`: `SyncState` gets `#[serde(default)] pub slot: Option<u32>`. Update every struct literal in the tests. Add the `set_farm_slot` command and a doc row.
- `sync_state.rs`: `pub fn set_farm_slot(&self, farm_id, root: &Path, slot: u32) -> Result<SyncState, Fs25Error>`. Model it on `set_bound_save`: create the state if it is missing, and set `slot` and `bound_save_path = slots::slot_path(root, slot)`. Reject slot 0.
- `lib.rs`: register it
- `src/lib/fs25.ts`: add `slot: number | null` to `SyncState` and `setFarmSlot(farmId, root, slot)`
- Every TS place that builds a `SyncState` literal (`download.ts`, `upload.ts`, tests) must carry the slot forward: `slot: existing?.slot ?? null`. Use `grep -rn "boundSavePath:" src/lib` to find them.

**Acceptance:**
- [x] An old state JSON without `slot` still reads, with `slot: None`
- [x] `set_farm_slot` on a new farm creates the state with the slot and path
- [x] `set_farm_slot` on an existing farm keeps its hashes and timestamps
- [x] Upload and download keep an existing slot when they write sync state (add one assertion to each existing TS test)

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check` — all pass, 0 errors.
Also run `cargo test --lib`.

## Work Log
- Done: added `SyncState.slot`, `sync_state::set_farm_slot` + `set_farm_slot` command and TS `slot`/`setFarmSlot`; upload/download carry slot forward; cargo test --lib 76 passed, node tests 101 pass, check clean.
