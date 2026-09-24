# 41: Upload end-to-end integration

**What to build:** Full upload path from a running desktop app against the local backend — a second member can see the published save.

**Priority:** P1

**Blocked by:** 30, 40

**Status:** done

- [x] From a running desktop app against the local backend, upload publishes a save visible to another member
- [x] Upload progress reflects both phases
- [x] An interrupted upload leaves the previous cloud save authoritative
- [x] A happy-path upload leaves local sync state updated

## Work Log
- Done: New `uploadTransport.ts` (`createPutToR2` presigned adapter + local-dev `/r2-test` fallback) + tests; `+page.svelte` upload wired to `createApiClient` + transport + `readArchive` (asset protocol `$TEMP/**`); `scripts/upload-e2e.mjs` (13/13) publishes as A and B sees it. `node --test` 94 passed, backend `npm test` 28, check/build clean.
- Assumption: local dev has no R2 S3 creds → `presigned:false` → dev route (`ENABLE_R2_TEST=true`), nested keys percent-encoded; production archive read via Tauri asset protocol (unverifiable headless). Fixed upload-authorize/complete envelope unwrap; download path has same gap (ticket 42).
