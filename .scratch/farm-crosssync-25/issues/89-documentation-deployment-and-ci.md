# 89: Refresh documentation, deployment configuration, and CI

**What to build:** Make the repository ready for reproducible releases by documenting setup, configuring real deployment targets, and automating verification.

**Priority:** P1

**Blocked by:** 71, 79

**Status:** done

- [x] The desktop and backend READMEs document prerequisites, local startup, environment variables, tests, builds, and installers.
- [x] Stale claims about unimplemented routes, stubs, verification counts, and old UI surfaces are removed.
- [x] Deployment configuration rejects placeholder database IDs, API URLs, and missing production secrets.
- [x] CI runs the documented install, typecheck, lint, test, and build checks for the desktop and backend.
- [x] Release metadata and environment configuration identify the actual product and deployment commands.

**Verify:** Run the documented local setup from a clean checkout and inspect the CI configuration for every required check.

## Work Log

- 2026-09-25: Done.
  - READMEs: `FarmCrossSync25-app/README.md` was the untouched Vite/Tauri template — rewritten (layout, prerequisites, local startup, environment variables, tests, e2e suites, build/installers, security posture). `FarmCrossSync25-backend/README.md` gained Tests and Environment variables sections plus full deploy-guard coverage.
  - Stale claims removed: backend README's `GET /farms/:farmId` "501 stub" block and its "farm detail (stub)" label; the "farm cascade is out of scope" claim (the last leaver does cascade); the "no .dev.vars needed" claim; `src/index.ts`'s "returns not_implemented" comment; `contract.rs`'s "stubs" comment; `docs/copy-audit.md` rows for the deleted `SaveLocation.svelte` and the moved size-warning surface.
  - Deployment configuration now rejects placeholder D1 database ids, placeholder endpoint URLs, and missing production secrets (`scripts/deploy-guard.mjs`, `src/deploy-guard.test.mjs` 11 tests). Verified: the checked-in `wrangler.jsonc` placeholder is refused.
  - CI: `.github/workflows/ci.yml` runs install, typecheck, lint and test + build for both projects (backend typecheck/test; desktop svelte-check/unit tests/build; Rust clippy + cargo test). YAML validated; every command re-run locally.
  - Release metadata: `package.json`/lock renamed from the scaffold `tauri-app` to `farm-crosssync25-app` with a real description; `npm ci` verified on both projects after the change.
