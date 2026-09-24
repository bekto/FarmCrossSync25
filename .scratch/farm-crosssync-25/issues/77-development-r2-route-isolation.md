# 77: Isolate the development-only R2 route

**What to build:** Keep the local R2 test route unavailable in every deployed environment while preserving the local development workflow.

**Priority:** P0

**Blocked by:** 71

**Status:** pending

- [ ] The R2 test route cannot be enabled accidentally in staging or production.
- [ ] The route rejects requests outside the local development environment.
- [ ] Local development can still run the R2 round-trip test with explicit local configuration.
- [ ] The route cannot be used to read or write arbitrary production bucket keys.

**Verify:** Run local R2 checks and inspect the production Worker configuration to confirm the test route is disabled.

## Work Log
