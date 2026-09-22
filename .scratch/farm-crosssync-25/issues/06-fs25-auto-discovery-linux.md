# 06: FS25 auto-discovery on Linux

**What to build:** Linux filesystem scan that returns FS25 savegame candidates from the native user-data location and common Steam/Proton compatdata layouts.

**Priority:** P0

**Blocked by:** 04

**Status:** pending

- [ ] Scan covers the native FS25 user-data location and common Steam/Proton layouts
- [ ] Candidate list shape matches the Windows scan result
- [ ] Missing or unreadable locations produce an empty list, not a crash
- [ ] Running the scan against a fixture folder tree lists exactly the fixture saves

## Work Log
