# 20: Join request

**What to build:** Requesting to join a farm with a farm code, producing a pending invite for the owner to review.

**Priority:** P0

**Blocked by:** 18

**Status:** pending

- [ ] `POST /farms/:farmId/join` with a valid code creates a pending invite for the caller
- [ ] Unknown code returns "farm not found"
- [ ] Joining while already a member returns "already a member"
- [ ] A second request while one is pending returns "pending request"
- [ ] A previously denied user can request again

## Work Log
