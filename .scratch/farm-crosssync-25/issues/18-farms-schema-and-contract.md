# 18: Farms schema and contract

**What to build:** D1 migrations for farms, farm_members, and farm_invites plus API route stubs for every farms endpoint in the spec.

**Priority:** P0

**Blocked by:** 02, 03

**Status:** done

- [x] Migrations create farms, farm_members, and farm_invites with the fields named in the spec
- [x] Migrations apply cleanly on a fresh local database and are re-runnable
- [x] Route stubs exist for every farms endpoint and return structured empty or not-implemented results
- [x] The 16-member cap is enforced in handlers and its rule is documented

## Work Log
- Done: `migrations/0003_farms.sql` (farms/farm_members/farm_invites + indexes), 9 auth-protected route stubs in `src/farms.ts` returning `501 not_implemented` (join enforces cap → `409 farm_full`), `MAX_FARM_MEMBERS=16` guard + tests. Migrations apply clean & re-runnable; `npm test` 4/4, typecheck clean.
- Assumption: stub convention 501 `{error:"not_implemented",endpoint}`; extracted inline `/me` auth into reusable `requireAuth` (no behavior change).
