# 07: FS25 savegame validator

**What to build:** Validation of a selected folder as an FS25 savegame with four states — Valid, Suspicious, Invalid, Inaccessible. Exact markers come from inspecting a real FS25 savegame first; do not guess file names.

**Priority:** P0

**Blocked by:** 04 (and a real FS25 savegame for marker inspection — see SPEC.md open questions)

**Status:** pending

- [ ] A real FS25 savegame folder validates as Valid and reports map and last-modified
- [ ] A folder missing some expected files validates as Suspicious
- [ ] An unrelated folder validates as Invalid
- [ ] An unreadable folder validates as Inaccessible
- [ ] Marker rules are documented in one place after inspecting the real save, with no invented file names

## Work Log
