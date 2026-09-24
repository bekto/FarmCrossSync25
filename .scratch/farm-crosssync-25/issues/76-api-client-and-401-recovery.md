# 76: Consolidate API clients and wire 401 recovery

**What to build:** Route production registration, farm, owner, and save requests through one consistent API client and recover cleanly from expired or invalid sessions.

**Priority:** P1

**Blocked by:** 71

**Status:** pending

- [ ] Production API services use the shared client instead of separate direct fetch implementations.
- [ ] A 401 clears the local session token and returns the application to the registration prompt.
- [ ] The deferred cloud action can resume after successful re-registration.
- [ ] API errors retain their HTTP status and server error code consistently across production services.

**Verify:** Run API-client, session, and production-service 401 recovery tests.

## Work Log
