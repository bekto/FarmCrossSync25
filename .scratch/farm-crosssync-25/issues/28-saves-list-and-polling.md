# 28: Saves list and polling

**What to build:** Farm save listing with timestamps and hashes, and a 20-second client poll while the farm screen is open.

**Priority:** P0

**Blocked by:** 25

**Status:** pending

- [ ] `GET /farms/:farmId/saves` returns each player's save name, file size, sha256, and uploaded_at
- [ ] A farm with no saves returns an empty list, not an error
- [ ] Non-members get 403
- [ ] The client refreshes this endpoint every 20 seconds while the farm screen is open

## Work Log
