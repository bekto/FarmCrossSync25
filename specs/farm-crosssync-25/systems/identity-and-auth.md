# Identity & Auth

## Purpose
Give each app installation a stable, passwordless player identity so farms can authorize who may upload and download saves. Solves "who is this?" without accounts, emails, or OAuth.

## User-facing behaviour
- Local save tools (scan, select, validate, backup, replace) work with no account and no network.
- On the first cloud action (create farm, join farm, upload, download) the user picks a display name — "What should your friends see you as?" — and continues.
- The app then registers the installation and the user is signed in from then on.
- Display name can be changed later in Settings.
- The user never sees or types credentials.

## Data it manages
- Installation ID: a random UUID generated on first need and kept locally. Not derived from hardware.
- User record on the server: id, installation_id, display_name, created_at, last_seen_at.
- Session token: opaque random string issued by the server at registration. The client stores it in OS secure storage; the server stores only its hash.

## Interfaces
- Consumes: display name from the Welcome/first-cloud-action screen.
- Emits: session token to the API client (attached to every protected call) and to secure storage.
- Network: `POST /register` (installation ID + display name → user + session token) and `GET /me` (current user).
- Re-registering with the same installation ID returns the same user and issues a new token.
- Updates `last_seen_at` when an authenticated request is served.

## Edge cases & constraints
- Lost token or wiped app data yields a new installation ID, therefore a new user. Identity migration between PCs or reinstalls is out of scope.
- No token expiry and no revocation in MVP.
- Offline on first cloud action: show a "need internet" error and retry; local tools stay usable.
- Never trust client-supplied user IDs for authorization. Identity always comes from the verified session token.
- Never place cloud secrets (API tokens, R2 keys, DB credentials, JWT signing secrets) in the desktop client. The client knows only `API_BASE_URL`.
- Display names need not be unique; immutable IDs distinguish players everywhere (including R2 paths).
- Do not use MAC addresses, CPU IDs, or OS hardware fingerprints as identity.
