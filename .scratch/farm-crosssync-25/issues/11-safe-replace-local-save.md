# 11: Safe replace of local save

**What to build:** Transactional replacement of the local savegame — extract to temp, verify content hash, create a backup, swap into place — such that any failure leaves the original untouched.

**Priority:** P0

**Blocked by:** 09, 10

**Status:** pending

- [ ] Replace extracts to a temporary location, verifies the content hash, then swaps into place
- [ ] A backup is created before the original is moved aside
- [ ] A hash mismatch aborts and leaves the original save untouched
- [ ] An interrupted replace leaves the original save untouched
- [ ] Local sync state is updated only after a successful swap

## Work Log
