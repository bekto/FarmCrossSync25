# 30: Client upload flow

**What to build:** One-click Upload My Save — validate, pack with progress, hash, authorize, put to R2, complete metadata — with two-phase progress and a safe failure story.

**Priority:** P0

**Blocked by:** 26, 29, 12

**Status:** pending

- [ ] Upload My Save validates, packs with progress, hashes, authorizes, puts to R2, then calls upload-complete
- [ ] UI shows two-phase progress (zipping, then uploading) and a success state with the new timestamp
- [ ] Failure before upload-complete leaves the previous cloud save unchanged and tells the user the local save is safe
- [ ] A save above ~200 MB shows a warning that can be dismissed to continue
- [ ] Local sync state records the uploaded hash and time

## Work Log
