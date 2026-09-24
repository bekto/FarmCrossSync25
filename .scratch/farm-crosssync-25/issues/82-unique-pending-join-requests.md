# 82: Prevent duplicate pending join requests

**What to build:** Allow at most one active pending join request for a user and farm while preserving the ability to request again after denial.

**Priority:** P1

**Blocked by:** 81

**Status:** pending

- [ ] Concurrent join requests from one installation do not create duplicate pending rows.
- [ ] A user with a pending request receives the existing-request result.
- [ ] A denied user can create a new pending request without reopening the denied row.
- [ ] Owner invite lists contain no duplicate active requests for the same user.

**Verify:** Run backend membership tests, including concurrent join requests.

## Work Log
