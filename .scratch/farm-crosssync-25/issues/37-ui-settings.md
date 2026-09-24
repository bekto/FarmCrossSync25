# 37: UI settings

**What to build:** Settings screen for display name, save path, backup location, farm info, Change Save, and Leave Farm.

**Priority:** P0

**Blocked by:** 16, 12, 10

**Status:** done

- [x] Settings shows and edits display name, save path (Change Save), and backup location
- [x] Farm ID and farm code are displayed
- [x] Leave Farm is present with a confirmation
- [x] Changing save or backup location reflects immediately in stored settings

## Work Log
- Done: New `settings.ts` (+ tests) + `SettingsScreen.svelte`; display name edit, Change Save (picker→validate→`set_bound_save`), backup location picker, farm id/code, Leave Farm with confirmation. Extended `identity.rs`/`identity.ts` with `backupLocation` get/set. `node --test` 71 passed, `cargo test --lib` 53 passed, check/build clean.
- Assumption: backup-location persisted in existing identity store (`identity.json`, `skip_serializing_if` unset); not yet passed to `create_backup` (later integration). Self-leave reuses members endpoint via `GET /me`.
