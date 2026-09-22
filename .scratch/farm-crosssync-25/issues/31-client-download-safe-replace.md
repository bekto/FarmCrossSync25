# 31: Client download and safe replace

**What to build:** Confirmed Download & Replace — backup, fetch archive, verify content hash after extract, replace local save — with the original recoverable on any failure.

**Priority:** P0

**Blocked by:** 27, 11, 29

**Status:** pending

- [ ] Download asks for confirmation and states that a backup will be created first
- [ ] Flow backs up the local save, fetches the archive, verifies the content hash after extract, then replaces the local save
- [ ] Hash mismatch aborts with a clear error and leaves the original save untouched
- [ ] Success updates local sync state and shows the new state
- [ ] Failure at any step leaves the original save recoverable

## Work Log
