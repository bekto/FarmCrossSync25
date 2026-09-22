# 46: Backend authorization tests

**What to build:** Automated checks that every authorization rule in the spec holds — upload own slot only, download as member, no cross-farm access, no self-accept, owner-only management — plus registration idempotence.

**Priority:** P2

**Blocked by:** 15, 18, 25

**Status:** pending

- [ ] Tests cover upload own slot only and download as member
- [ ] Tests cover no cross-farm access and no self-accept of a join request
- [ ] Tests cover owner-only accept/deny, kick, and transfer ownership
- [ ] Tests cover registration idempotence on the same installation_id
- [ ] `npm test` exits 0 in the backend repository

## Work Log
