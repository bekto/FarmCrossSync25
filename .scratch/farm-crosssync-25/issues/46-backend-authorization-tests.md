# 46: Backend authorization tests

**What to build:** Automated checks that every authorization rule in the spec holds — upload own slot only, download as member, no cross-farm access, no self-accept, owner-only management — plus registration idempotence.

**Priority:** P2

**Blocked by:** 15, 18, 25

**Status:** done

- [x] Tests cover upload own slot only and download as member
- [x] Tests cover no cross-farm access and no self-accept of a join request
- [x] Tests cover owner-only accept/deny, kick, and transfer ownership
- [x] Tests cover registration idempotence on the same installation_id
- [x] `npm test` exits 0 in the backend repository

## Work Log
- Done: New `src/authz.test.mjs` (9 subtests) + `src/ts-resolve-hooks.mjs`; in-process HTTP integration via `app.request()` with a `node:sqlite` D1 shim (real migrations) + in-memory R2. Covers upload own-slot, download as member, no cross-farm access, no self-accept, owner-only management, registration idempotence. `npm test` 37/37 exit 0, typecheck clean.
- Assumption: in-process integration chosen over spawning `wrangler dev` for speed/determinism; pure helpers remain in `farms.test.mjs`.
