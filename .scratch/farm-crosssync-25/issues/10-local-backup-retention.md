# 10: Local backup with retention

**What to build:** Timestamped local backups under a user-configurable directory (default app data), keeping only the five newest copies.

**Priority:** P0

**Blocked by:** 04

**Status:** done

- [x] Every backup writes a timestamped copy under the configured backup directory
- [x] Default backup directory is the app data directory and Settings can point it elsewhere
- [x] Only the five newest backups are kept and older ones are pruned
- [x] A failed backup aborts the operation it was protecting and leaves the original untouched
- [x] Changing the backup directory does not move existing backups

## Work Log
- Done: `backup::create_backup` copies save → `<root>/<savegame>_backup<timestamp>`, prunes to 5 newest per savegame, default root `dirs::data_dir()/com.farmcrosssync.desktop`; honors passed `backup_dir`. Failure returns Err + removes partial dest, original untouched. `cargo test --lib` 26 passed. Command wired.
- Assumption: default app-data resolved via `dirs::data_dir()/com.farmcrosssync.desktop` (matches Tauri app_data_dir; no AppHandle threaded). Retention scoped per savegame name; foreign dirs never pruned; symlinks skipped.
