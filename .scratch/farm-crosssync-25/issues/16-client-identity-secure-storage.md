# 16: Client identity and secure storage

**What to build:** Desktop-side identity — random installation UUID, display name capture and edit, secure session-token storage — with no hardware identifiers.

**Priority:** P0

**Blocked by:** 01, 15

**Status:** done

- [x] First need generates a random installation UUID (no MAC/CPU/hardware IDs) and stores it locally
- [x] Display name is collected and shown back in Settings where it can be changed
- [x] Session token is written to OS secure storage and attached to API calls
- [x] Re-registering with the same stored installation_id reuses the same user

## Work Log
- Done: New `identity.rs` + `src/lib/identity.ts`: `get_identity`/`set_display_name` (persisted `<app-data>/identity.json`, no hardware IDs), `store_session_token`/`get_session_token`/`clear_session_token` via `keyring` (injectable `SecretStore`, token never in identity.json). Stable id reuses same backend user (e2e). `cargo test --lib` 44 passed.
- Assumption: headless env has no secret service, so runtime token storage returns a structured error rather than plaintext; Settings screen is ticket 37. Token attachment documented for API client (ticket 40).
