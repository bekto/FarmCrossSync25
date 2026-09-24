# 24: Farm deletion cascade

**What to build:** When the last member leaves, the farm and everything it owns in the cloud are deleted.

**Priority:** P0

**Blocked by:** 22

**Status:** done

- [x] When the last member leaves, the farm row and its membership rows are deleted
- [x] All R2 save objects under the farm prefix are deleted
- [x] Pending invites for that farm are deleted
- [x] A request for the deleted farm afterwards returns "farm not found"

## Work Log
- Done: Cascade on last-member leave deletes `farm_invites`, `player_saves`, `farm_members`, `farms`, then R2 objects via `deleteFarmSaves` (cursor-paginated prefix loop in `saves.ts`). Also implemented `GET /farms/:farmId` (404 missing / 403 non-member). `npm test` 24/24, typecheck clean; e2e counts all 0 + R2 gone.
- Assumption: R2 full pagination loop; added additive `farmDeleted` flag to delete response; `GET /farms/:farmId` member-gated.
