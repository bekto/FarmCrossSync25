# 03: Local development environment

**What to build:** A fully local backend stack — local Worker, local D1, and a local R2 stand-in — so API work and tests need no Cloudflare account. Choose and document the R2 simulation approach (open question in SPEC.md).

**Priority:** P0

**Blocked by:** 02

**Status:** done

- [x] Documented commands bring up Worker + D1 + R2 stand-in from a clean checkout
- [x] A put then get of a test object through the R2 binding round-trips bytes unchanged against the local stand-in
- [x] D1 schema migrations apply locally and are re-runnable
- [x] README states which R2 simulation approach was chosen and how to run it
- [x] No Cloudflare account or network access is required to run this stack

## Work Log
- Done: Documented local stack (README), added dev-gated `/r2-test/:key` route + `scripts/r2-roundtrip-check.sh` proving 4096-byte R2 round-trip, migrations apply twice (second no-op). R2 approach = Wrangler/Miniflare built-in local R2.
- Assumption: Miniflare in-process local R2 suffices; no Docker/S3 stand-in. Resolves SPEC open question (README only).
