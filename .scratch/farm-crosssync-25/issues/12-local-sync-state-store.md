# 12: Local sync state store

**What to build:** Persistent local metadata per farm — bound save path, last_synced_hash, last_synced_at — used for conflict detection and upload bookkeeping.

**Priority:** P0

**Blocked by:** 04

**Status:** done

- [x] State records bound save path, last_synced_hash, and last_synced_at per farm
- [x] State survives an app restart
- [x] Changing the bound save via Settings updates the stored path
- [x] State is readable and writable only through the Tauri command layer

## Work Log
- Done: New `sync_state.rs` persists `SyncState` per farm as JSON under `<app-data>/sync-state/<farm_id>.json`; `SyncState` extended with `bound_save_path`/`last_synced_hash`/`last_synced_at` (serde default). `read_sync_state`/`write_sync_state` wired + new `set_bound_save` command; TS wrappers updated. `cargo test --lib` 37 passed, `npm run check` clean.
- Assumption: last_synced_* = most recent successful sync; default root `dirs::data_dir()/com.farmcrosssync.desktop/sync-state` (injectable); farm_id sanitized to one path component.
