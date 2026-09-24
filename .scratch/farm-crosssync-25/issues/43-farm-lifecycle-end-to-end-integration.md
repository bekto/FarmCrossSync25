# 43: Farm lifecycle end-to-end integration

**What to build:** Two clients exercising create, join, approve, kick/leave, ownership transfer, succession, and farm deletion against the local backend.

**Priority:** P1

**Blocked by:** 19, 20, 21, 22, 23, 24, 40

**Status:** done

- [x] Two clients can create, join, approve, and see each other's saves
- [x] Kick and leave remove access and delete that player's cloud save
- [x] Ownership transfer and leave-succession both work between two clients
- [x] Last member leaving deletes the farm and its saves

## Work Log
- Done: New `scripts/farm-lifecycle-e2e.mjs` (41/41) driving two clients through create/join/approve/kick/leave/transfer/succession/deletion against local Worker; frontend services exercised via real `createApiClient`/`createFarmScreen`/`createOwnerActions`/`createSettings`. `node --test` 98 passed, backend `npm test` 28, check/build clean.
- Root-cause fix: backend succession updated `farm_members.role` but not `farms.owner_id`; now both updated (`src/index.ts`). Assumption: ownership stored in both places must agree. GUI click-through and real presigned R2 unverifiable headless.
