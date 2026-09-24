# 89: Refresh documentation, deployment configuration, and CI

**What to build:** Make the repository ready for reproducible releases by documenting setup, configuring real deployment targets, and automating verification.

**Priority:** P1

**Blocked by:** 71, 79

**Status:** pending

- [ ] The desktop and backend READMEs document prerequisites, local startup, environment variables, tests, builds, and installers.
- [ ] Stale claims about unimplemented routes, stubs, verification counts, and old UI surfaces are removed.
- [ ] Deployment configuration rejects placeholder database IDs, API URLs, and missing production secrets.
- [ ] CI runs the documented install, typecheck, lint, test, and build checks for the desktop and backend.
- [ ] Release metadata and environment configuration identify the actual product and deployment commands.

**Verify:** Run the documented local setup from a clean checkout and inspect the CI configuration for every required check.

## Work Log
