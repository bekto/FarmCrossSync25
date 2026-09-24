# 28: Saves list and polling

**What to build:** Farm save listing with timestamps and hashes, and a 20-second client poll while the farm screen is open.

**Priority:** P0

**Blocked by:** 25

**Status:** done

- [x] `GET /farms/:farmId/saves` returns each player's save name, file size, sha256, and uploaded_at
- [x] A farm with no saves returns an empty list, not an error
- [x] Non-members get 403
- [x] The client refreshes this endpoint every 20 seconds while the farm screen is open

## Work Log
- Done: Backend `GET /farms/:farmId/saves` (member-gated, joins `users.display_name`, empty → `200 {saves:[]}`, non-member 403). App `src/lib/poll.ts` DOM-free DI poller (default 20 000 ms, start/stop) + `poll.test.ts` (5/5). Backend typecheck + `npm test` 28/28; app check/build clean.
- Assumption: list fields snake_case matching members/invites envelopes; order `uploaded_at DESC, user_id ASC`; poller swallows fetch errors unless `onError` given. Farm screen (ticket 35) will consume the helper.
