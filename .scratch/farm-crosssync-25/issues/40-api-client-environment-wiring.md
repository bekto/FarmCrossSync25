# 40: API client and environment wiring

**What to build:** A single API client that attaches the session token, reads API_BASE_URL from configuration, and supports local, staging, and production.

**Priority:** P1

**Blocked by:** 15, 18, 25

**Status:** pending

- [ ] One API client attaches the session token to every protected call
- [ ] API_BASE_URL comes from configuration, not hardcoded throughout the app
- [ ] Local, staging, and production base URLs are selectable by environment
- [ ] 401 responses surface a re-register or retry path instead of failing silently

## Work Log
