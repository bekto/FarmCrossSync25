# 25: Saves schema and contract

**What to build:** D1 migration for player_saves plus API route stubs for every saves endpoint, with a single documented R2 key layout.

**Priority:** P0

**Blocked by:** 18

**Status:** done

- [x] Migration creates player_saves with the fields named in the spec
- [x] Route stubs exist for every saves endpoint in the spec
- [x] The R2 key layout `farms/{farm_id}/players/{user_id}/save` is documented and used in one place
- [x] Migrations apply cleanly on a fresh local database

## Work Log
- Done: `migrations/0004_player_saves.sql` (7 spec fields, composite PK + farm index), `src/saves.ts` with single-source `saveObjectKey`/`farmSavesPrefix` + row types, 4 saves routes registered behind auth returning `501 not_implemented`. Clean+re-runnable migrations; typecheck/tests clean.
- Assumption: all 4 saves routes (incl. list) use the ticket-18 `501` stub convention for consistency; `PLAYER_SAVES_FIELDS`/`PlayerSaveRow` exported for tickets 26-28.
