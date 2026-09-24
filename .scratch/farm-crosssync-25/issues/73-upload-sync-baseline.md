# 73: Persist the sync baseline after successful uploads

**What to build:** Treat a completed cloud upload as a successful sync so later downloads compare against the uploaded save rather than an older baseline.

**Priority:** P0

**Blocked by:** 72

**Status:** pending

- [ ] A successful upload records the uploaded hash and timestamp as the most recent sync baseline.
- [ ] A failed upload does not change the previous sync baseline.
- [ ] Upload preserves unrelated per-farm state such as the bound slot and download history.
- [ ] An upload followed by a local modification triggers conflict detection before downloading the cloud save.

**Verify:** Run the upload flow unit tests and the upload-to-download conflict regression test.

## Work Log
