# 19: Create farm and farm code

**What to build:** Farm creation where the caller becomes owner and first member, and receives a short, case-insensitive, unique invite code.

**Priority:** P0

**Blocked by:** 15, 18

**Status:** pending

- [ ] `POST /farms` with a name creates a farm and makes the caller owner and first member
- [ ] Response includes a short, case-insensitive, unique code in the `X7K9-PQ2` shape
- [ ] A code colliding with an existing farm is regenerated
- [ ] Only authenticated users can create a farm

## Work Log
