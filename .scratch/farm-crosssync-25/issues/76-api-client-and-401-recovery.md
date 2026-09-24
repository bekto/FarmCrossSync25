# 76: Consolidate API clients and wire 401 recovery

**What to build:** Route production registration, farm, owner, and save requests through one consistent API client and recover cleanly from expired or invalid sessions.

**Priority:** P1

**Blocked by:** 71

**Status:** done

- [x] Production API services use the shared client instead of separate direct fetch implementations.
- [x] A 401 clears the local session token and returns the application to the registration prompt.
- [x] The deferred cloud action can resume after successful re-registration.
- [x] API errors retain their HTTP status and server error code consistently across production services.

**Verify:** Run API-client, session, and production-service 401 recovery tests.

## Work Log

All four hand-rolled fetch paths now route through the shared `createApiClient`
(api.ts:63-66), so every production service surfaces `ApiError(status, message,
code)` built from the backend's `{ "error": "<code>" }` envelope (api.ts:31-41,
81-105) — the raw `request failed: <status>` / `register failed: <status>`
strings are gone.

- `src/lib/session.ts:113-132` — `httpRegister` builds on `createApiClient`
  (`auth: false`, no bearer header) and keeps its `(baseUrl, fetchImpl,
  onUnauthorized?)` shape.
- `src/lib/ownerActions.ts:210-249` — `httpOwnerApi` delegates to the shared
  client; 204 responses map to `{}` as before.
- `src/lib/farmScreen.ts:340-366` — `httpFarmApi` delegates to the shared client.
- `src/lib/farmSetup.ts:185-221` — `httpFarmSetupApi` delegates; the
  lookup-then-join sequence is unchanged.
- `src/lib/errors.ts:120-127` — `friendlyErrorMessage` now keys on the live
  server error string `farm not found`; the obsolete `request failed: 404`
  pattern (never produced any more) was removed (errors.test.ts:104-107 re-pinned
  to the live input).

401 recovery (production wiring `src/routes/+page.svelte:117-125`): one
`handleUnauthorized` is injected into the shared client (156-160) and all four
services (131, 303, 467, 489-492, 505). It clears the stored token via
`clearSessionToken()` (identity.ts:53-55) and the cached token in `session.ts`,
then returns to the registration prompt.

- `src/lib/session.ts:68-75` — `Session.handleUnauthorized()` drops the cached
  token (`null`, never re-served even if the store clear fails), resets to
  `awaitingName`, and re-opens the display-name prompt.
- `src/lib/session.ts:77-99` — `runCloudAction` catches `UnauthorizedError` from
  a running action, re-queues that action in the existing `pending` slot, and
  returns `undefined` (the established "queued" signal). `submitDisplayName`
  already resumes `pending` after a successful re-registration, so the deferred
  cloud action survives the clear and resumes.

Tests (`node --test` on the six touched suites): 59 pass / 0 fail —
session.test.ts:123-232 adds the 401-mid-action resume, cache-clear, and
`httpRegister` ApiError/401-hook cases; ownerActions.test.ts:180-245,
farmSetup.test.ts:162-235, and farmScreen.test.ts:215-280 add the token-attach,
envelope, ApiError-status/code/message, and UnauthorizedError+hook cases for
each production service.

Full verification battery (after all three tickets landed):
`npm run check` 205 files / 0 errors / 0 warnings · `node --test src/lib/*.test.ts`
177 pass / 0 fail · `cargo test` 93 pass / 0 fail · `npm run build` OK ·
`npm run upload:e2e` 17/0 · `npm run download:e2e` 23/0 ·
`npm run reliability:e2e` 28/0 · `npm run lifecycle:e2e` 41/0.
