# 81: Enforce farm capacity under concurrent invitations

**What to build:** Make the 16-member farm limit hold when multiple owners or requests accept members at the same time.

**Priority:** P1

**Blocked by:** 71

**Status:** pending

- [ ] Concurrent invitation acceptance cannot produce a farm with more than 16 members.
- [ ] A farm at capacity returns a deterministic conflict response.
- [ ] The acceptance result and membership state remain consistent when two acceptance requests race.
- [ ] The implementation includes a concurrency regression test or an equivalent database-level invariant test.

**Verify:** Run backend authorization tests and the new concurrent-capacity test.

## Work Log
