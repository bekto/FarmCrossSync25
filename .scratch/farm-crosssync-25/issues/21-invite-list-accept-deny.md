# 21: Invite list and accept/deny

**What to build:** Owner-only listing of pending join requests with accept and deny actions that create or refuse membership.

**Priority:** P0

**Blocked by:** 20

**Status:** done

- [x] `GET /farms/:farmId/invites` returns pending requests to the owner only
- [x] Accept sets the invite accepted and creates a farm_members row
- [x] Deny sets the invite denied and creates no membership
- [x] A non-owner calling accept or deny gets 403
- [x] Accepting when the farm is at 16 members is rejected

## Work Log
- Done: Implemented `GET /farms/:farmId/invites` (owner-only, pending + display_name), `POST /invites/:id/accept` (owner-only, capacity check, sets accepted + inserts member in one flow), `POST /invites/:id/deny` (owner-only, denied, no membership). `npm test` 12/12, typecheck clean; e2e 403/409/200 verified.
- Assumption: acting on non-pending invite → `409 invite_not_pending`; envelopes `{invites:[...]}` / `{invite:{...}}`; capacity via existing `isAtCapacity`.
