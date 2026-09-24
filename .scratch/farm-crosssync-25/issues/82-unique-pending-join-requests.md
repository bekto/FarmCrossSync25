# 82: Prevent duplicate pending join requests

**What to build:** Allow at most one active pending join request for a user and farm while preserving the ability to request again after denial.

**Priority:** P1

**Blocked by:** 81

**Status:** done

- [x] Concurrent join requests from one installation do not create duplicate pending rows.
- [x] A user with a pending request receives the existing-request result.
- [x] A denied user can create a new pending request without reopening the denied row.
- [x] Owner invite lists contain no duplicate active requests for the same user.

**Verify:** Run backend membership tests, including concurrent join requests.

## Work Log

New migration `migrations/0005_unique_pending_join_requests.sql`: a partial
unique index `idx_farm_invites_pending_unique ON farm_invites(farm_id,
user_id) WHERE status = 'pending'` (:23-25) makes one-pending-request-per-user
a database invariant (the old `idx_farm_invites_farm_user` from 0003 stays for
the non-pending lookups). The index covers only `status = 'pending'`, so a
denied user's fresh request is a NEW row and the denied row is never reopened
(deliberate behaviour preserved). The migration first dedupes any pre-existing
duplicate pending rows keeping the earliest (DELETE at :14-21) so it applies
cleanly on live databases. Applied locally with
`npx wrangler d1 migrations apply DB --local` (3 commands, ✅).

Race handling in `POST /farms/:farmId/join`: the existing pending pre-check
still returns `409 {"error":"pending request"}` for the sequential case, and
the INSERT is now wrapped so a unique violation — a concurrent duplicate that
raced past the check — surfaces as that same existing-request result
(`409 {"error":"pending request"}`) instead of a 500
(FarmCrossSync25-backend/src/index.ts:309-329; the catch matches `unique` in
the error and rethrows anything else).

`GET /farms/:farmId/invites` needs no change and is free of duplicate active
requests by construction: it lists only `status = 'pending'` rows, and the
partial unique index permits at most one such row per (farm, user).

Tests (src/join-requests.test.mjs, in `npm test`): concurrent duplicate joins
(`Promise.all` of two `app.request()` joins) → exactly one 201 + one
`409 "pending request"`, exactly one pending row in the database, owner's
invite list shows the user once; sequential duplicate → `409 "pending request"`
(existing-request result); denied → new 201 with a fresh invite id while the
denied row stays `denied` (DB keeps one denied + one pending, list shows one
active); invite-list de-duplication after racing duplicates for two users with
denied histories (unique user_ids, one active each); schema-level invariant
test bypassing the handler — a second pending INSERT rejects with a unique
error while multiple denied rows coexist fine. Evidence:
`node --test src/join-requests.test.mjs` → 6 tests / 6 pass / 0 fail.

README: new "Join requests" section (unique pending invariant, race →
`409 "pending request"`, denied-history behaviour, invite-list guarantee).
