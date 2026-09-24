# 30: Client upload flow

**What to build:** One-click Upload My Save — validate, pack with progress, hash, authorize, put to R2, complete metadata — with two-phase progress and a safe failure story.

**Priority:** P0

**Blocked by:** 26, 29, 12

**Status:** done

- [x] Upload My Save validates, packs with progress, hashes, authorizes, puts to R2, then calls upload-complete
- [x] UI shows two-phase progress (zipping, then uploading) and a success state with the new timestamp
- [x] Failure before upload-complete leaves the previous cloud save unchanged and tells the user the local save is safe
- [x] A save above ~200 MB shows a warning that can be dismissed to continue
- [x] Local sync state records the uploaded hash and time

## Work Log
- Done: New DOM-free DI `src/lib/upload.ts` (`runUpload`) sequencing validate→metadata→pack(progress)→hash→authorize→PUT→complete→writeSyncState, temp cleanup on success/failure; `UploadProgress.svelte` (two-phase + success timestamp + size warning + error). `node --test src/lib/*.test.ts` 17 passed; check/build clean.
- Assumption: `putToR2` injected (production fetch PUT to presigned URL; no production adapter shipped since API client is ticket 40 and archive-read command absent — YAGNI). Size warning uses local save size; `upload-complete.fileSize` uses packed size. UI is standalone for ticket 35.
