# 27: Download authorize

**What to build:** Worker-side download authorization giving any authenticated farm member short-lived read access to another member's save object.

**Priority:** P0

**Blocked by:** 25

**Status:** pending

- [ ] `download-authorize` issues temporary read authorization to any authenticated member of the farm
- [ ] A non-member gets 403
- [ ] A member cannot receive authorization for a farm they do not belong to
- [ ] Expired authorizations are rejected

## Work Log
