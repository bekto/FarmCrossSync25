# 83: Add session expiry and revocation

**What to build:** Give user sessions a bounded lifetime and an explicit server-side invalidation path without changing passwordless installation identity.

**Priority:** P1

**Blocked by:** 76

**Status:** done

- [x] Expired sessions are rejected by protected backend routes.
- [x] The user can sign out and the stored local token is removed. (Backend half: the `POST /logout` route — see Work Log. Desktop half landed with the follow-up desktop agent: Settings "Sign out" runs `POST /logout` then clears the stored token and session cache.)
- [x] Registering again does not accidentally preserve an explicitly revoked session.
- [x] The desktop client handles expiry through the shared unauthorized recovery flow. (Desktop side verified: ticket 76's shared recovery — `handleUnauthorized` clears the stored + cached token and returns to the registration prompt with the deferred action resumable — covers expiry, revocation, and sign-out alike; the backend contract makes 401 `{"error":"unauthorized"}` the single signal for expired, revoked, missing, and unknown tokens.)

**Verify:** Run backend identity/session tests and the desktop 401 recovery tests.

## Work Log

Backend half complete. The desktop halves of 83/84 are outside this backend assignment and deliberately deferred to a follow-up desktop agent (per Main: they touch `api.ts`, `session.ts`, `identity.ts`, `settings.ts`, and `+page.svelte`, which `DesktopApiSecurity` is editing for tickets 76/79/85 — running both at once would conflict); the desktop boxes stay unticked until that work lands and is verified.

- `FarmCrossSync25-backend/migrations/0006_session_expiry.sql:9-13` — `sessions.expires_at` column (ISO-8601 UTC, same shape as `created_at`); existing rows backfilled to migration run time + 30 days so they remain valid.
- `FarmCrossSync25-backend/src/identity.ts:15` — exported `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000` (30 days, documented). It lives in the pure `src/identity.ts` module rather than the worker entry: workerd treats every named entry-module export as a request handler and crashes at boot (`TypeError: Incorrect type for map entry ...` — caught by `wrangler dev` integration, fixed by moving both constants out; verified booting cleanly afterward).
- `FarmCrossSync25-backend/src/index.ts:117-129` — `POST /register` now writes `expires_at = issued + SESSION_TTL_MS`; response shape/status unchanged.
- `FarmCrossSync25-backend/src/index.ts:138-152` — `requireAuth` loads `expires_at` and rejects expired/missing/unparseable sessions (fail closed) with `401 {"error":"unauthorized"}` — byte-identical to the missing-token response, so expiry and revocation are indistinguishable.
- `FarmCrossSync25-backend/src/index.ts:203-214` — `POST /logout` (behind `requireAuth`) deletes exactly the calling session's row (`DELETE FROM sessions WHERE token_hash = ?`) and returns `200 {"ok":true}`; a revoked row is never re-inserted, and `/register` mints a fresh random token per call, so re-registering cannot resurrect it.
- Tests: `FarmCrossSync25-backend/src/sessions.test.mjs` — 7 cases covering valid session accepted; expired session rejected on `/me`, `/farms`, `/farms/:farmId/members` with a response identical to a missing token; NULL/unparseable expiry fails closed; logout revokes only the calling session (the user's other session survives) and a second logout is 401; logout without a valid token is 401; re-register issues a new working token while the revoked one stays dead. All pass under `npm test` (see test evidence below).
- Desktop halves (session-expiry recovery flow, removing the stored local token on sign-out) are desktop-side work outside this assignment, deliberately deferred to a follow-up desktop agent and held to the backend contract above (401 clears the stored + cached token, returns to the registration prompt with the deferred action resumable).

### Desktop half (follow-up desktop agent, FarmCrossSync25-app)

- `FarmCrossSync25-app/src/lib/session.ts:34-44` — new `LogoutFn` type and `SessionDeps.clearToken` / `SessionDeps.logout` injections; `session.ts:62-69` documents `Session.signOut`.
- `FarmCrossSync25-app/src/lib/session.ts:92-109` — `signOut()`: `POST /logout` first and **best-effort** (a failed `/logout` — offline or already revoked — is swallowed so the user is never stranded), then drops the cached token and any queued cloud action, awaits `clearToken` (`clear_session_token`), and returns to the registration prompt (`state = "awaitingName"` + `onRequireDisplayName`). Dropping the queued action is deliberate: unlike 401 recovery, signing out is an explicit exit, so nothing must resume behind the user's back after re-registering.
- `FarmCrossSync25-app/src/routes/+page.svelte:132,137-139` — production wiring: `clearToken: clearSessionToken`, `logout: () => api.post("/logout")` through the shared API client (a 401 there runs the shared recovery hook first — the right end state for an already-revoked session).
- `FarmCrossSync25-app/src/lib/settings.ts:92-94,287-300` — `signOutConfirmation()` copy and `SettingsScreen.signOut()`: confirmation first (same `ConfirmFn`/`ConfirmDialog` path as Leave Farm), then the injected sign-out; `settings.ts:54-58` the `SettingsDeps.signOut` seam.
- `FarmCrossSync25-app/src/lib/components/SettingsScreen.svelte:101-105,231-244` — real affordance: a "Sign out" row in Settings' Danger zone (logout icon, disabled while busy) that runs the confirmed flow.
- Expiry handling is the pre-existing shared unauthorized recovery flow (ticket 76) — verified by reading it, not reworked: `src/routes/+page.svelte:123-126 handleUnauthorized` calls `clearSessionToken()` then `session.handleUnauthorized()`, and is passed as `onUnauthorized` to the shared API client (`+page.svelte:167`) and every service factory (`:134` register, `:306`/`:498` farmApi, `:470`/`:500` ownerApi, `:516` farmSetup); `src/lib/session.ts:83-90` drops the cached token and returns to the prompt with the deferred action resumable (re-queued at `session.ts:123`, resumed at `session.ts:148-151`).
- Tests — `src/lib/session.test.ts:182-261`: "signOut revokes the session, clears both tokens, and returns to the prompt" (POST /logout called, `clear_token` called, cached token never re-served), "sign-out still clears local credentials when /logout fails" (offline/revoked safety), "sign-out drops the queued action so nothing resumes behind the user's back", "registering again after sign-out stores only the fresh token" (the revoked token is never re-stored). `src/lib/settings.test.ts:412-446`: "signOut proceeds only after confirmation" / "signOut is skipped when the confirmation is declined" (no session change) / "signOut reports a failure to sign out locally".
- Evidence: `node --test src/lib/*.test.ts` 185 passed / 0 failed; `npm run check` 205 files, 0 errors 0 warnings; `npm run build` clean; e2e upload 17/17, download 17/17, reliability 28/28, lifecycle 41/41 (full-suite counts shared with the 84/88 desktop work in this same run).
