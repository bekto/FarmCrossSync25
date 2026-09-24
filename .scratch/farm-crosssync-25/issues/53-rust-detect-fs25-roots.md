# 53: Rust — auto-detect FS25 folder candidates

**What to build:** A `detect_fs25_roots` command that returns the existing FS25 user-data folders on this machine (the folders that hold `savegameN`), with the most likely one first.

**Priority:** P0

**Blocked by:** none

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src-tauri/src/fs25/discovery/linux.rs`: add `pub fn linux_roots() -> Vec<PathBuf>`. It returns `linux_base_dir()` plus every Steam/Proton `.../Documents/My Games/FarmingSimulator2025` folder. Extract that path-walking out of `scan_steam_root_in` so both functions share it. Keep only the paths that are directories.
- `src-tauri/src/fs25/discovery/windows.rs`: add `pub fn windows_roots() -> Vec<PathBuf>`, reusing the base-dir logic already in that file
- `discovery/mod.rs`: `pub fn detect_roots() -> Vec<PathBuf>`. It dispatches by OS, dedupes, and sorts roots that contain at least one `savegameN` first.
- `contract.rs`: `detect_fs25_roots() -> Result<Vec<String>, Fs25Error>` and a doc row. `lib.rs`: register it. `fs25.ts`: `detectFs25Roots()`.

**Acceptance:**
- [x] Existing `scan_saves` tests still pass unchanged
- [x] New unit test: a Steam fixture tree (like `scans_steam_proton_fixture`) yields the `FarmingSimulator2025` folder as a root
- [x] No root found returns `Ok(vec![])`, not an error

**Verify:** `cd FarmCrossSync25-app/src-tauri && cargo test --lib` passes; `cd FarmCrossSync25-app && npm run check` clean.

## Work Log
- Done: added `linux_roots`/`windows_roots`/`detect_roots` + `detect_fs25_roots` command and TS `detectFs25Roots`; shared Steam walker extracted; cargo test --lib 67 passed, npm run check clean.
