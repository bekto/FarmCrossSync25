# 22: Members list, kick, and leave

**What to build:** Member listing plus owner kick and self leave, both of which end membership and delete that player's cloud save in the farm while leaving local saves untouched.

**Priority:** P0

**Blocked by:** 18

**Status:** pending

- [ ] `GET /farms/:farmId/members` returns member display names and join times
- [ ] Owner kick removes the member and deletes their cloud save in the farm
- [ ] Self leave removes the caller and deletes their own cloud save in the farm
- [ ] A non-owner kicking someone else gets 403
- [ ] Local saves are never touched by kick or leave

## Work Log
