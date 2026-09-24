# 55: Rust — list which farm owns which slot

**What to build:** A `list_slot_bindings()` command that reads every stored sync-state file and returns `{ farmId, slot }` for each farm that has a slot. The UI uses it to disable slots that belong to other farms.

**Priority:** P0

**Blocked by:** 54

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `sync_state.rs`: `pub fn list_bindings(&self) -> Result<Vec<SlotBinding>, Fs25Error>`. It reads `<root>/*.json`, skips unreadable or malformed files, and skips states whose `slot` is None.
- `contract.rs`: `SlotBinding` struct (camelCase), the command, a doc row. `lib.rs`: register it. `fs25.ts`: `SlotBinding` and `listSlotBindings()`.

**Acceptance:**
- [x] Two farms with slots 1 and 2 plus one farm without a slot: 2 bindings returned
- [x] A missing sync-state directory returns an empty list
- [x] A corrupt JSON file is skipped, not an error

**Verify:** `cd FarmCrossSync25-app/src-tauri && cargo test --lib` passes; `cd FarmCrossSync25-app && npm run check` clean.

## Work Log
- Done: added `sync_state::list_bindings` + `SlotBinding`/`list_slot_bindings` command and TS binding; cargo test --lib 79 passed, npm run check clean.
