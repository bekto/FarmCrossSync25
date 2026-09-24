# 08: FS25 save metadata extraction

**What to build:** Lightweight extraction of save slot, map name, last-modified, path, and size from a savegame folder, without parsing the whole save.

**Priority:** P0

**Blocked by:** 07

**Status:** done

- [x] Metadata includes slot, map name, last-modified, path, and size
- [x] Extraction reads only lightweight metadata files, not the entire save
- [x] Metadata for a real savegame matches what the save actually reports
- [x] A save missing optional metadata still returns partial results without error

## Work Log
- Done: `metadata::extract` returns slot/map/mtime/path/size (size walked from file metadata only); reads only `careerSavegame.xml`. Real save → slot 1, map "Zielonka", 38303104 bytes. `read_metadata` command wired; `cargo test --lib` 15 passed.
- Assumption: `content_hash` left empty (hashing is ticket 09 and would read the whole save). Missing path = Err(Inaccessible); missing internal metadata = partial Ok.
