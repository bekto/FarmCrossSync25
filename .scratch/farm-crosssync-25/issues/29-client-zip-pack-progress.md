# 29: Client zip pack with progress

**What to build:** Packing a bound save folder into a single zip archive with progress reporting, never mutating the source.

**Priority:** P0

**Blocked by:** 09

**Status:** done

- [x] Packing a save folder produces a single zip whose extract reproduces the folder contents
- [x] Packing reports progress events from 0 to 100
- [x] Packing never modifies the source save folder
- [x] The zip is written to a temp location and cleaned up after use

## Work Log
- Done: New `fs25/pack.rs` (`pack_save` with `FnMut(u8)` progress, `cleanup_pack`, temp UUID archive, failed archive removed) + `PackResult`/commands in `contract.rs`, TS wrappers; extracted shared `hash::stable_files`. `cargo test --lib` 48 passed, `npm run check` clean.
- Assumption: archive kept until caller calls `cleanup_pack` (upload must read it first); progress surfaced via Tauri event `fs25-pack-progress` at command layer; ordering/error semantics mirror `hash.rs`. Added `zip` crate (deflate).
