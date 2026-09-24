# 45: Rust unit tests for FS25 core

**What to build:** Automated checks for hashing, validation classification, backup retention, and replace abort behaviour on fixture folders.

**Priority:** P2

**Blocked by:** 07, 09, 10, 11

**Status:** done

- [x] Tests cover hash stability and change detection on fixture folders
- [x] Tests cover validator state classification on fixture folders
- [x] Tests cover backup retention keeping five copies and replace abort on hash mismatch
- [x] `cargo test` exits 0

## Work Log
- Done: Added `hash::same_folder_hashed_twice_is_stable`; confirmed existing validator-state, retention, and replace-abort coverage. `cargo test` exit 0, 54 lib tests.
- Bug fixed: `backup::unique_destination` reused a just-pruned base name, making retention flaky under same-millisecond backups; now suffixes above all existing siblings (name order = chronological). Retention test 80 runs flake-free.
