# 10: Local backup with retention

**What to build:** Timestamped local backups under a user-configurable directory (default app data), keeping only the five newest copies.

**Priority:** P0

**Blocked by:** 04

**Status:** pending

- [ ] Every backup writes a timestamped copy under the configured backup directory
- [ ] Default backup directory is the app data directory and Settings can point it elsewhere
- [ ] Only the five newest backups are kept and older ones are pruned
- [ ] A failed backup aborts the operation it was protecting and leaves the original untouched
- [ ] Changing the backup directory does not move existing backups

## Work Log
