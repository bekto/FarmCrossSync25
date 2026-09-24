# 78: Validate R2 upload metadata and object integrity

**What to build:** Ensure a completed upload records metadata that matches the object actually stored in R2 and reject implausible or mismatched uploads.

**Priority:** P0

**Blocked by:** 77

**Status:** pending

- [ ] Upload completion verifies that the expected object exists and has the expected byte size.
- [ ] Objects exceeding the configured maximum size are rejected.
- [ ] Missing, malformed, or mismatched metadata does not replace the previous authoritative save metadata.
- [ ] The behavior of client-supplied content hashes is documented as either verified or an explicit trust boundary.

**Verify:** Run backend upload authorization tests with missing, incorrect-size, oversized, and valid objects.

## Work Log
