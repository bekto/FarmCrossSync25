# 40: API client and environment wiring

**What to build:** A single API client that attaches the session token, reads API_BASE_URL from configuration, and supports local, staging, and production.

**Priority:** P1

**Blocked by:** 15, 18, 25

**Status:** done

- [x] One API client attaches the session token to every protected call
- [x] API_BASE_URL comes from configuration, not hardcoded throughout the app
- [x] Local, staging, and production base URLs are selectable by environment
- [x] 401 responses surface a re-register or retry path instead of failing silently

## Work Log
- Done: New `api.ts` (`createApiClient`, single auth-header build, typed `ApiError`/`UnauthorizedError`, injected `onUnauthorized` hook) + tests; `config.ts` env resolver (`VITE_APP_ENV` local/staging/production, `VITE_API_BASE_URL` override) + tests. `node --test` 90 passed, check/build clean.
- Assumption: env var `VITE_APP_ENV` (default local); staging/prod URLs placeholders until Worker deployed; existing services not rewired yet (tickets 41-43).
