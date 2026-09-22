# 08: FS25 save metadata extraction

**What to build:** Lightweight extraction of save slot, map name, last-modified, path, and size from a savegame folder, without parsing the whole save.

**Priority:** P0

**Blocked by:** 07

**Status:** pending

- [ ] Metadata includes slot, map name, last-modified, path, and size
- [ ] Extraction reads only lightweight metadata files, not the entire save
- [ ] Metadata for a real savegame matches what the save actually reports
- [ ] A save missing optional metadata still returns partial results without error

## Work Log
