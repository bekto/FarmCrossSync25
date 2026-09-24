# 84: Synchronize display-name changes with the backend

**What to build:** Make the display name shown to farm members update when the user changes it in Settings.

**Priority:** P1

**Blocked by:** 76

**Status:** done

- [x] An authenticated user can update their display name through the backend.
- [x] The desktop Settings flow sends the changed name through the shared API client. (Desktop half landed with the follow-up desktop agent: `saveDisplayName` sends `PATCH /me` through the shared `createApiClient` instance — see Work Log.)
- [x] Farm member lists show the new name after the next refresh.
- [x] A failed update leaves the local setting clearly distinguishable from a confirmed cloud update. (Backend half: precise, non-ambiguous error codes. Desktop half landed with the follow-up desktop agent: the local write and the cloud update are separate steps and a cloud failure reports the divergence plainly — see Work Log.)

**Verify:** Run backend identity tests, settings tests, and a farm-member refresh regression test.

## Work Log

Backend half complete. The desktop halves of 83/84 are outside this backend assignment and deliberately deferred to a follow-up desktop agent (per Main: they touch `api.ts`, `session.ts`, `identity.ts`, `settings.ts`, and `+page.svelte`, which `DesktopApiSecurity` is editing for tickets 76/79/85 — running both at once would conflict); the desktop boxes stay unticked until that work lands and is verified.

- `FarmCrossSync25-backend/src/index.ts:179-200` — `PATCH /me` (behind `requireAuth`): body `{ "displayName": string }`, trimmed and stored via `UPDATE users SET display_name = ?` (`src/index.ts:196`); `200 {"user": <toUser shape>}`. `400 {"error":"displayName is required"}` for missing/non-string/blank-after-trim; `400 {"error":"displayName must be at most 64 characters"}` for names over `MAX_DISPLAY_NAME_LENGTH` (`src/identity.ts:22`, matching the client's 64-char Settings cap) — never silently truncated. Failed updates store nothing, so an unchanged cloud name plus the distinct error codes keeps a local setting clearly distinguishable from a confirmed cloud update.
- `FarmCrossSync25-backend/src/index.ts:423`, `src/index.ts:525`, `src/index.ts:691` — `GET /farms/:farmId/invites`, `GET /farms/:farmId/members`, and `GET /farms/:farmId/saves` all `JOIN users` on `display_name`, so they show the new name after the next refresh with no further changes.
- `POST /register`, `GET /me`, and all other existing routes: response shapes and status codes unchanged.
- Tests: `FarmCrossSync25-backend/src/display-name.test.mjs` — 6 cases covering: trimmed name stored and returned in the exact `toUser` shape; renamed member visible in `GET /farms/:farmId/members` (other members unchanged); renamed pending joiner visible in `GET /farms/:farmId/invites`; missing/non-string/blank bodies all `400 {"error":"displayName is required"}` with the stored name surviving; 65-char name `400` with the distinct length error and no truncation while 64 chars are accepted; `PATCH /me` without/with a bogus token is `401 {"error":"unauthorized"}`. All pass under `npm test`.
- Desktop halves (Settings flow through the shared API client, local-vs-cloud setting state) are desktop-side work outside this assignment, deliberately deferred to a follow-up desktop agent and held to the backend contract above (Settings sends the rename through the shared API client and distinguishes a failed cloud update from a local one).

### Desktop half (follow-up desktop agent, FarmCrossSync25-app)

- `FarmCrossSync25-app/src/lib/settings.ts:180-219` — `saveDisplayName` treats the two writes as separate concerns: trim + validate (blank rejected; > 64 rejected, never truncated — mirroring the backend), local Rust write (`set_display_name`) first, then `PATCH /me` through the shared API client (`settings.ts:43` `updateCloudDisplayName` seam, wired at `src/routes/+page.svelte:482-485` as `api.request("/me", { method: "PATCH", body: { displayName } })` on the shared `createApiClient` instance).
- Local write lands even when the cloud is unreachable; on cloud failure the view shows `cloudUpdateFailedMessage(reason)` (`settings.ts:106-108`): "Display name updated on this device only; the cloud name did not change (…). Farm members still see the old name." — plainly stating the divergence instead of an ambiguous success. Full success is the only path that reports `DISPLAY_NAME_SYNCED_MESSAGE` ("updated and synced to the cloud", `settings.ts:111-112`); `saveDisplayName` resolves `true` only then, `false` on any failure.
- Validation is now explicit client-side and matches `PATCH /me` exactly: `MAX_DISPLAY_NAME_LENGTH = 64` (`settings.ts:100`); the Settings input's `maxlength` was raised from 32 to 64 (`src/lib/components/SettingsScreen.svelte:136`) so the desktop accepts exactly what the backend accepts (the backend Work Log above already assumed a 64-char client cap).
- Tests — `src/lib/settings.test.ts:145-220`: "saveDisplayName persists locally and syncs the cloud name" (both writes, synced message, `true`), "saveDisplayName accepts a 64-character name like the backend does" (boundary), "saveDisplayName rejects a blank name without calling Tauri", "saveDisplayName rejects an over-long name instead of truncating" (65 chars, zero calls), "a failed cloud update leaves a clearly diverged local setting" (local name changed, error === `cloudUpdateFailedMessage("boom")`, no synced message, `false`), "a failed local write never reaches the cloud update" (cloud step skipped). The old "persists and updates the view immediately" test was updated to the new contract: success now requires the cloud confirmation (behaviour change, justified by the acceptance criterion) and the exported `SettingsDeps`/`SettingsScreen` shapes are otherwise preserved.
- Evidence: `node --test src/lib/*.test.ts` 185 passed / 0 failed (settings+session subset 38/38 before the 88 cleanup); `npm run check` 205 files, 0 errors 0 warnings; `npm run build` clean; e2e upload 17/17, download 17/17, reliability 28/28, lifecycle 41/41 (full-suite counts shared with the 83/88 desktop work in this same run).
