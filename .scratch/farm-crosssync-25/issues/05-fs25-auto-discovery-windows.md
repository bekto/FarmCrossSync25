# 05: FS25 auto-discovery on Windows

**What to build:** Windows filesystem scan that returns FS25 savegame candidates from the standard Documents / My Games location.

**Priority:** P0

**Blocked by:** 04

**Status:** pending

- [ ] On Windows, scan returns all savegame candidates under the standard Documents / My Games FS25 location
- [ ] Each candidate includes path, slot number, and last-modified time
- [ ] Missing or unreadable locations produce an empty list, not a crash
- [ ] Running the scan against a fixture folder tree lists exactly the fixture saves

## Work Log
