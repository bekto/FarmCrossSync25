# 06: FS25 auto-discovery on Linux

**What to build:** Linux filesystem scan that returns FS25 savegame candidates from the native user-data location and common Steam/Proton compatdata layouts.

**Priority:** P0

**Blocked by:** 04

**Status:** done

- [x] Scan covers the native FS25 user-data location and common Steam/Proton layouts
- [x] Candidate list shape matches the Windows scan result
- [x] Missing or unreadable locations produce an empty list, not a crash
- [x] Running the scan against a fixture folder tree lists exactly the fixture saves

## Work Log
- Done: `discovery/linux.rs` scans `$XDG_DATA_HOME/FarmingSimulator2025` native + Steam/Proton `compatdata/*/.../My Games/FarmingSimulator2025` (globbed, no hardcoded AppID); reuses `SaveCandidate`/shared `slot_of`; `contract::scan_saves` now dispatches by OS. `cargo test --lib` 6 passed.
- Assumption: Steam user dirs globbed via read_dir; only `Documents/My Games/...` searched; map_name stays None until metadata ticket.
