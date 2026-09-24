# 07: FS25 savegame validator

**What to build:** Validation of a selected folder as an FS25 savegame with four states — Valid, Suspicious, Invalid, Inaccessible. Exact markers come from inspecting a real FS25 savegame first; do not guess file names.

**Priority:** P0

**Blocked by:** 04 (and a real FS25 savegame for marker inspection — see SPEC.md open questions)

**Status:** done

- [x] A real FS25 savegame folder validates as Valid and reports map and last-modified
- [x] A folder missing some expected files validates as Suspicious
- [x] An unrelated folder validates as Invalid
- [x] An unreadable folder validates as Inaccessible
- [x] Marker rules are documented in one place after inspecting the real save, with no invented file names

## Work Log
- Done: Validator in `validator.rs` (state enum + map/mtime) against real save markers: core `careerSavegame.xml`, expected `farms.xml`/`players.xml`/`environment.xml`. Wired `validate_save` command. Real save → Valid, map "Zielonka"; `cargo test --lib` 11 passed. Rules documented in module docs.
- Assumption: last-modified = folder filesystem mtime (not internal `saveDate`); map from `<mapTitle>` fallback `<mapId>`; `validate_save` returns Ok with Inaccessible state rather than Err. Real save read-only.
