# 21: Invite list and accept/deny

**What to build:** Owner-only listing of pending join requests with accept and deny actions that create or refuse membership.

**Priority:** P0

**Blocked by:** 20

**Status:** pending

- [ ] `GET /farms/:farmId/invites` returns pending requests to the owner only
- [ ] Accept sets the invite accepted and creates a farm_members row
- [ ] Deny sets the invite denied and creates no membership
- [ ] A non-owner calling accept or deny gets 403
- [ ] Accepting when the farm is at 16 members is rejected

## Work Log
