# 12: Local sync state store

**What to build:** Persistent local metadata per farm — bound save path, last_synced_hash, last_synced_at — used for conflict detection and upload bookkeeping.

**Priority:** P0

**Blocked by:** 04

**Status:** pending

- [ ] State records bound save path, last_synced_hash, and last_synced_at per farm
- [ ] State survives an app restart
- [ ] Changing the bound save via Settings updates the stored path
- [ ] State is readable and writable only through the Tauri command layer

## Work Log
