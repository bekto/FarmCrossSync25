# 32: Conflict detection

**What to build:** Warning before a download replaces a local save that changed since the last sync, with Keep Mine / Download Cloud / Cancel.

**Priority:** P0

**Blocked by:** 12, 31

**Status:** pending

- [ ] Before a download, if local content hash is not equal to last_synced_hash, the conflict dialog appears
- [ ] Keep My Save aborts the download and leaves local data unchanged
- [ ] Download Cloud Save proceeds into the normal backup/verify/replace flow
- [ ] Cancel closes the dialog and does nothing

## Work Log
