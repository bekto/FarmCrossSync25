# 77: Isolate the development-only R2 route

**What to build:** Keep the local R2 test route unavailable in every deployed environment while preserving the local development workflow.

**Priority:** P0

**Blocked by:** 71

**Status:** done

- [x] The R2 test route cannot be enabled accidentally in staging or production.
- [x] The route rejects requests outside the local development environment.
- [x] Local development can still run the R2 round-trip test with explicit local configuration.
- [x] The route cannot be used to read or write arbitrary production bucket keys.

**Verify:** Run local R2 checks and inspect the production Worker configuration to confirm the test route is disabled.

## Work Log

Fail-closed four-layer gate on `PUT/GET /r2-test/:key` (FarmCrossSync25-backend):
layer 1 unchanged `ENABLE_R2_TEST === "true"` else 404 (src/index.ts:786-788);
layer 2 explicit local-only marker `FARM_CROSSSYNC_LOCAL_DEV === "true"` and
layer 3 loopback Host (`localhost`/`127.0.0.1`/`[::1]`, any port) else
`403 {"error":"r2_test_local_only"}` plus a loud `console.warn`
(src/index.ts:789-797, `isLoopbackHost` src/saves.ts:38-49); layer 4 key-space
confine — the URL-decoded key must match
`farms/{farmId}/players/{userId}/save` with id-shaped segments
(`[A-Za-z0-9_-]+`, i.e. exactly `saveObjectKey`'s shape), explicit `..`
traversal reject, else `400 {"error":"invalid_key"}` (src/index.ts:801-812,
`PLAYER_SAVE_OBJECT_KEY_PATTERN`/`isPlayerSaveObjectKey` src/saves.ts:26-30).
Bare dot-segments never reach the handler — WHATWG URL parsing collapses them
before routing (verified: `/r2-test/..`, `/r2-test/%2E%2E` normalize to `/`).
Desktop dev-mode fallback keys (`farms/{farmId}/players/{userId}/save`,
`/`→`%2F`) still pass: Hono decodes `%2F` in `:key` before the shape check.

Deploy-time guard: `npm run deploy` now runs `scripts/deploy-guard.mjs`
(package.json:7) before `wrangler deploy`; it JSONC-parses
wrangler.jsonc/wrangler.json (all `vars` blocks incl. per-env) and aborts the
deploy if `ENABLE_R2_TEST` or `FARM_CROSSSYNC_LOCAL_DEV` is set there
(scripts/deploy-guard.mjs:19,94-113,138-144), failing closed on unparsable
config; wrangler.toml presence is scanned for the names (scripts/deploy-guard.mjs:126-136).
Documentation: README "Development-only R2 test route" (the four layers, the
two env markers, loopback requirement, `.dev.vars` convenience vs `--var`
command line, "NEVER set these in a deployed environment") and updated
"R2 round-trip check" section. `scripts/r2-roundtrip-check.sh` passes both
markers via `--var` (no `.dev.vars` dependency) and uses key
`farms/roundtrip-check/players/roundtrip-check/save` percent-encoded like the
desktop client. `.dev.vars` also carries both markers as human convenience.

Tests (src/r2test.test.mjs, in `npm test`): disabled by default (404 without
switch; switch alone → 403), enabled only under the full local condition
(PUT/GET byte round trip via `localhost` and `127.0.0.1`), rejected outside
local dev (`403 r2_test_local_only` for non-loopback hosts
`https://farms.example.com`/`http://10.0.0.5:8787` and for missing marker;
404 without switch), rejected for disallowed keys (traversal
`farms/../players/u1/save`, `farms/f1/players/../save`, encoded
`save%2F..%2F..%2Fsecret`, old single-segment `roundtrip-check`, other shapes →
`400 invalid_key`; bare dot-segments neutralized to 404), and deploy guard
(ships-clean assertion on the real wrangler.jsonc + trips on `vars`/env-vars
configs + comment stripping). Evidence: `node --test src/r2test.test.mjs` →
6 tests / 6 pass / 0 fail; `node --test src/authz.test.mjs` (harness
refactor, `src/test-harness.mjs`) → 9 pass; `npm run r2:check` →
`PASS: R2 round-trip bytes unchanged (4096 bytes)`; `node scripts/deploy-guard.mjs`
→ `deploy-guard: wrangler.jsonc carries no dev-only vars`.
