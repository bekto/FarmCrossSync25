# 15: Backend identity endpoints

**What to build:** Passwordless registration and current-user lookup — `POST /register` and `GET /me` — with server-side token hashing and idempotent re-registration.

**Priority:** P0

**Blocked by:** 02, 03

**Status:** pending

- [ ] `POST /register` with installation_id and display_name creates a user and returns an opaque session token
- [ ] Re-registering the same installation_id returns the same user and a new token
- [ ] `GET /me` with a valid token returns the current user and without one returns 401
- [ ] Only the token hash is stored server-side
- [ ] `last_seen_at` updates on authenticated requests

## Work Log
