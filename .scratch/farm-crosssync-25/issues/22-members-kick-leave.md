# 22: Members list, kick, and leave

**What to build:** Member listing plus owner kick and self leave, both of which end membership and delete that player's cloud save in the farm while leaving local saves untouched.

**Priority:** P0

**Blocked by:** 18

**Status:** done

- [x] `GET /farms/:farmId/members` returns member display names and join times
- [x] Owner kick removes the member and deletes their cloud save in the farm
- [x] Self leave removes the caller and deletes their own cloud save in the farm
- [x] A non-owner kicking someone else gets 403
- [x] Local saves are never touched by kick or leave

## Work Log
- Done: `GET /farms/:farmId/members` (member-only, display_name + joined_at + role), `DELETE /farms/:farmId/members/:userId` (self-leave or owner-kick; 403 non-owner; `DB.batch` deletes `player_saves` + `farm_members`, then R2 `BUCKET.delete(saveObjectKey(...))`). Owner-leave promotes earliest-joined survivor. `npm test` 17/17, typecheck clean; e2e D1+R2 deletion verified.
- Assumption: owner-leave promotion overlaps ticket 23 (implemented minimally); last-member farm cascade deferred to ticket 24; R2 delete after DB batch may orphan object (spec-acceptable).
