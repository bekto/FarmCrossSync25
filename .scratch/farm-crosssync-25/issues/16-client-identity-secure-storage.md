# 16: Client identity and secure storage

**What to build:** Desktop-side identity — random installation UUID, display name capture and edit, secure session-token storage — with no hardware identifiers.

**Priority:** P0

**Blocked by:** 01, 15

**Status:** pending

- [ ] First need generates a random installation UUID (no MAC/CPU/hardware IDs) and stores it locally
- [ ] Display name is collected and shown back in Settings where it can be changed
- [ ] Session token is written to OS secure storage and attached to API calls
- [ ] Re-registering with the same stored installation_id reuses the same user

## Work Log
