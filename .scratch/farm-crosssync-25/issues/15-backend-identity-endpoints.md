# 15: Backend identity endpoints

**What to build:** Passwordless registration and current-user lookup — `POST /register` and `GET /me` — with server-side token hashing and idempotent re-registration.

**Priority:** P0

**Blocked by:** 02, 03

**Status:** done

- [x] `POST /register` with installation_id and display_name creates a user and returns an opaque session token
- [x] Re-registering the same installation_id returns the same user and a new token
- [x] `GET /me` with a valid token returns the current user and without one returns 401
- [x] Only the token hash is stored server-side
- [x] `last_seen_at` updates on authenticated requests

## Work Log
- Done: `migrations/0002_identity.sql` (users + sessions), `POST /register`/`GET /me` with SHA-256 token-hash storage and `last_seen_at` stamping; `scripts/identity-check.sh` (npm `identity:check`) all PASS. Same installation_id → same user + new token.
- Assumption: re-register keeps existing display name; old+new tokens both remain valid (no revocation in MVP); only token_hash stored.
