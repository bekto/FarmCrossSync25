# 09: FS25 content hash

**What to build:** The single content hash used for upload metadata, download verification, and conflict detection — SHA-256 over the save folder's file contents in stable relative-path order (not the zip envelope).

**Priority:** P0

**Blocked by:** 04

**Status:** pending

- [ ] Hash is SHA-256 over file contents in stable relative-path order (not the zip envelope)
- [ ] Hashing the same unchanged save twice yields the same value
- [ ] Changing one file in the save changes the hash
- [ ] Hashing an empty or missing folder returns a structured error

## Work Log
