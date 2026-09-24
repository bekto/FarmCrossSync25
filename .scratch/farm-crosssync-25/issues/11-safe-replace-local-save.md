# 11: Safe replace of local save

**What to build:** Transactional replacement of the local savegame — extract to temp, verify content hash, create a backup, swap into place — such that any failure leaves the original untouched.

**Priority:** P0

**Blocked by:** 09, 10

**Status:** done

- [x] Replace extracts to a temporary location, verifies the content hash, then swaps into place
- [x] A backup is created before the original is moved aside
- [x] A hash mismatch aborts and leaves the original save untouched
- [x] An interrupted replace leaves the original save untouched
- [x] Local sync state is updated only after a successful swap

## Work Log
- Done: New `replace.rs` — copy staged dir to sibling temp, verify staged hash vs `expected_hash`, backup original, rename-swap with rollback on failure. `replace_save` command wired. `cargo test --lib` 31 passed (5 replace tests incl. failpoint rollback).
- Assumption: `staged_path` is an already-extracted directory (zip extraction is ticket 31); sync-state persistence owned by caller/flow (ticket 31), replace never touches it; `ReplaceResult{replaced:true}` only after swap. Rename non-atomic across target path (`ponytail:` noted).
