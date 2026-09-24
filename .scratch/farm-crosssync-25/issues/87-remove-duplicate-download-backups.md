# 87: Remove redundant download backups

**What to build:** Ensure a cloud-driven replacement creates exactly one backup and reports the backup created by the authoritative filesystem operation.

**Priority:** P2

**Blocked by:** 75

**Status:** pending

- [ ] A used-slot download creates one backup rather than a TypeScript backup plus a replacement backup.
- [ ] The configured backup location is honored by the authoritative replacement operation.
- [ ] Empty-slot downloads still create no backup.
- [ ] Download progress and success copy describe the actual backup behavior.

**Verify:** Run download tests with backup spies and compare the resulting backup directories.

## Work Log
