# 05: FS25 auto-discovery on Windows

**What to build:** Windows filesystem scan that returns FS25 savegame candidates from the standard Documents / My Games location.

**Priority:** P0

**Blocked by:** 04

**Status:** done

- [x] On Windows, scan returns all savegame candidates under the standard Documents / My Games FS25 location
- [x] Each candidate includes path, slot number, and last-modified time
- [x] Missing or unreadable locations produce an empty list, not a crash
- [x] Running the scan against a fixture folder tree lists exactly the fixture saves

## Work Log
- Done: `scan_windows_in(base)` + `scan_windows()` in `discovery/windows.rs` (via `dirs::document_dir()` known-folder), candidates `{path, slot, last_modified}`; empty list on missing/unreadable; fixture test passes (`cargo test --lib fs25::discovery::windows` 1 passed).
- Assumption: cross-OS `contract::scan_saves` dispatch left `NotImplemented` intentionally; wiring completes with Linux discovery (ticket 06). Added `dirs`/`chrono` (already in `Cargo.lock`).
