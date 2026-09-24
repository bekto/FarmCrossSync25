# 31: Client download and safe replace

**What to build:** Confirmed Download & Replace — backup, fetch archive, verify content hash after extract, replace local save — with the original recoverable on any failure.

**Priority:** P0

**Blocked by:** 27, 11, 29

**Status:** done

- [x] Download asks for confirmation and states that a backup will be created first
- [x] Flow backs up the local save, fetches the archive, verifies the content hash after extract, then replaces the local save
- [x] Hash mismatch aborts with a clear error and leaves the original save untouched
- [x] Success updates local sync state and shows the new state
- [x] Failure at any step leaves the original save recoverable

## Work Log
- Done: New Rust `unpack_save`/`cleanup_unpack` (traversal-safe zip extract) + commands/TS wrappers; DOM-free DI `src/lib/download.ts` (`runDownload`: confirm→backup→authorize→fetch→unpack→hash→replace→writeSyncState, temp cleanup). `cargo test --lib` 50 passed, `node --test` 24 passed, check/build clean.
- Assumption: `fetchArchive` injected (production fetches presigned URL directly; no native HTTP-download command added — outside ticket). Double backup intentional (flow + replace.rs); `confirm` optional defaulting to proceed; `lastDownloadedAt` = client time.
