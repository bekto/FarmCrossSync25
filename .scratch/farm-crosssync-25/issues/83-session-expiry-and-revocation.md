# 83: Add session expiry and revocation

**What to build:** Give user sessions a bounded lifetime and an explicit server-side invalidation path without changing passwordless installation identity.

**Priority:** P1

**Blocked by:** 76

**Status:** pending

- [ ] Expired sessions are rejected by protected backend routes.
- [ ] The user can sign out and the stored local token is removed.
- [ ] Registering again does not accidentally preserve an explicitly revoked session.
- [ ] The desktop client handles expiry through the shared unauthorized recovery flow.

**Verify:** Run backend identity/session tests and the desktop 401 recovery tests.

## Work Log
