# 32: Conflict detection

**What to build:** Warning before a download replaces a local save that changed since the last sync, with Keep Mine / Download Cloud / Cancel.

**Priority:** P0

**Blocked by:** 12, 31

**Status:** done

- [x] Before a download, if local content hash is not equal to last_synced_hash, the conflict dialog appears
- [x] Keep My Save aborts the download and leaves local data unchanged
- [x] Download Cloud Save proceeds into the normal backup/verify/replace flow
- [x] Cancel closes the dialog and does nothing

## Work Log
- Done: New `src/lib/conflict.ts` (`detectConflict`, `resolveConflict`, `runDownloadWithConflict` wrapper) + `ConflictDialog.svelte` (Keep My Save / Download Cloud Save / Cancel). `download.ts` untouched; gate consulted before `runDownload`. `node --test` 36 passed, check/build clean.
- Assumption: `lastSyncedHash === null` → first sync, no conflict; `localHash === null` with prior sync → conflict (safest). Added `allowImportingTsExtensions` to tsconfig for svelte-check on existing `.ts` imports.
