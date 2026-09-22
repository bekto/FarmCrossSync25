# 03: Local development environment

**What to build:** A fully local backend stack — local Worker, local D1, and a local R2 stand-in — so API work and tests need no Cloudflare account. Choose and document the R2 simulation approach (open question in SPEC.md).

**Priority:** P0

**Blocked by:** 02

**Status:** pending

- [ ] Documented commands bring up Worker + D1 + R2 stand-in from a clean checkout
- [ ] A put then get of a test object through the R2 binding round-trips bytes unchanged against the local stand-in
- [ ] D1 schema migrations apply locally and are re-runnable
- [ ] README states which R2 simulation approach was chosen and how to run it
- [ ] No Cloudflare account or network access is required to run this stack

## Work Log
