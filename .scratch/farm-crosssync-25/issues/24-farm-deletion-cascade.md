# 24: Farm deletion cascade

**What to build:** When the last member leaves, the farm and everything it owns in the cloud are deleted.

**Priority:** P0

**Blocked by:** 22

**Status:** pending

- [ ] When the last member leaves, the farm row and its membership rows are deleted
- [ ] All R2 save objects under the farm prefix are deleted
- [ ] Pending invites for that farm are deleted
- [ ] A request for the deleted farm afterwards returns "farm not found"

## Work Log
