# 29: Client zip pack with progress

**What to build:** Packing a bound save folder into a single zip archive with progress reporting, never mutating the source.

**Priority:** P0

**Blocked by:** 09

**Status:** pending

- [ ] Packing a save folder produces a single zip whose extract reproduces the folder contents
- [ ] Packing reports progress events from 0 to 100
- [ ] Packing never modifies the source save folder
- [ ] The zip is written to a temp location and cleaned up after use

## Work Log
