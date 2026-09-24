# 73: Persist the sync baseline after successful uploads

**What to build:** Treat a completed cloud upload as a successful sync so later downloads compare against the uploaded save rather than an older baseline.

**Priority:** P0

**Blocked by:** 72

**Status:** done

- [x] A successful upload records the uploaded hash and timestamp as the most recent sync baseline.
- [x] A failed upload does not change the previous sync baseline.
- [x] Upload preserves unrelated per-farm state such as the bound slot and download history.
- [x] An upload followed by a local modification triggers conflict detection before downloading the cloud save.

**Verify:** Run the upload flow unit tests and the upload-to-download conflict regression test.

## Work Log

## Work Log

- `src/lib/upload.ts:201-219` — on upload success the state write now advances `lastSyncedHash`/`lastSyncedAt` to the uploaded hash/timestamp (matching `sync_state.rs:23-25` "most recent successful sync"), merging into the existing per-farm state (bound slot, download history, timestamps preserved). Failure paths never reach the write, so the previous baseline stays byte-identical. Header docs updated (upload.ts:8-13).
- Tests (`upload.test.ts:289-401`): "a successful upload advances the sync baseline" (baseline + preserved slot/download history), "a failed upload leaves the previous sync baseline byte-identical" (JSON snapshot equality, no writeSync call), "upload-then-modify triggers conflict detection before a download" (unchanged -> no conflict, modified -> conflict against the written baseline via `detectConflict`).
