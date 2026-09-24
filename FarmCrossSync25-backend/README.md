# FarmCrossSync25 Backend

Cloudflare Worker (Hono, TypeScript) + D1 + R2 for FarmCrossSync25.

## Prerequisites

- Node.js 20+ (developed on v24)
- No Cloudflare account or network access is required: everything below runs
  against Wrangler's local simulation.

## Setup

```bash
npm install
```

## Apply D1 migrations locally

```bash
npx wrangler d1 migrations apply DB --local
```

Wrangler records applied migrations, so re-running the command prints
`No migrations to apply!` and exits successfully.

## Bring up the local stack

```bash
npm run dev
```

This starts the Worker on http://localhost:8787 with the local D1 database
(`DB`) and local R2 bucket (`BUCKET`). Both bindings are simulated on disk
under `.wrangler/state/`, which is gitignored. Check it with:

```bash
curl http://localhost:8787/health   # {"status":"ok"}
```

Local development does not require `.dev.vars`; the dev-only R2 route markers
can also be passed on the `wrangler dev` command line (see "Development-only R2
test route"). `.dev.vars` (gitignored) is a convenience for humans and is also
where real R2 S3 credentials would go.

## Identity & sessions

Migration `0002_identity.sql` creates `users` and `sessions`; migration
`0006_session_expiry.sql` gives sessions a bounded lifetime. Routes:

- `POST /register` — body `{ "installationId": "...", "displayName": "..." }`. Idempotent on
  `installation_id` (the request's `displayName` is only used at creation); returns
  `{ "user": {...}, "token": "..." }`. A fresh session token is minted on every call.
- `GET /me` — `{ "user": { id, installationId, displayName, createdAt, lastSeenAt } }`.
- `PATCH /me` — body `{ "displayName": "..." }`. Stores the trimmed name (1–64 characters,
  matching the client's Settings input cap) and returns `{ "user": {...} }`. Blank or
  missing names are `400 {"error":"displayName is required"}`; over-long names are
  `400 {"error":"displayName must be at most 64 characters"}` — never silently truncated,
  so a failed update is distinguishable from a confirmed one. All name-bearing lists
  (`/farms/:farmId/members`, `/farms/:farmId/invites`, `/farms/:farmId/saves`) join
  `users.display_name`, so they show the new name on the next refresh.
- `POST /logout` — revokes exactly the calling session and returns `{ "ok": true }`.
  A revoked token can never be revived; registering again issues a new random token.

**Sessions:** the raw token (32 random bytes, hex) is returned once at registration and
stored only as a SHA-256 hash in `sessions`. A session is valid for
`SESSION_TTL_MS` (30 days — the exported constant in `src/index.ts`) via
`sessions.expires_at`; migration `0006_session_expiry.sql` backfills pre-existing
rows to migration run time + 30 days so they remain valid. Expired, revoked,
missing, and unknown tokens all get the identical `401 {"error":"unauthorized"}`
from `requireAuth`, so clients recover through a single unauthorized path and
cannot probe which case occurred.

## Farms & membership

Migration `0003_farms.sql` creates `farms`, `farm_members`, and `farm_invites`
(see `specs/farm-crosssync-25/systems/farms-and-membership.md`).

Every farms endpoint from the spec is registered behind bearer-token auth:

- `POST /farms` — create (creator becomes owner)
- `GET /farms/:farmId` — farm detail
- `POST /farms/:farmId/join` — request to join by code
- `GET /farms/:farmId/invites`, `POST /invites/:inviteId/accept`, `POST /invites/:inviteId/deny` — owner only
- `GET /farms/:farmId/members` — member list (members only; `user_id`, `display_name`, `role`, `joined_at`)
- `DELETE /farms/:farmId/members/:userId` — owner kick, or self-leave
- `POST /farms/:farmId/transfer-owner` — owner hands ownership to a member (body `{ "userId": "..." }`; previous owner stays a member)

**Kick = leave.** `DELETE /farms/:farmId/members/:userId` ends the membership,
deletes the target's `player_saves` row, and deletes their R2 object via the
shared `saveObjectKey(farmId, userId)` helper. Any member may delete their own
row (leave); deleting someone else requires the farm owner. **Local saves are
never touched** — the Worker has no filesystem access; local files are a client
concern. When the owner leaves while members remain, the earliest-joined
survivor is promoted to `owner` (the owner may also transfer explicitly).
The last member leaving deletes the farm and cascades to its memberships,
invites, and cloud saves (the save objects are removed from R2).

**Member cap:** a farm holds a maximum of 16 members. The shared constant is
`MAX_FARM_MEMBERS` in `src/farms.ts`. Enforcement is two-layered: the join
route pre-checks capacity as an early-out (409
`{"error": "farm_full", "max": 16}` — fail closed if the count is unreadable),
and the authoritative guard is the accept-time membership `INSERT ... SELECT
... WHERE (SELECT COUNT(*) ...) < 16` inside the same D1 batch that resolves
the invite (see "Accepting a join request"). Concurrent accepts can therefore
never exceed 16 members. `npm test` covers the 15-ok / 16-rejected boundary
and fires concurrent accepts (`src/capacity.test.mjs`).

### Join requests

`POST /farms/:farmId/join` — body `{ code }`. A caller may hold at most one
active (pending) request per farm. Migration `0005_unique_pending_join_requests.sql`
enforces this as a database invariant — a partial unique index on
`farm_invites(farm_id, user_id) WHERE status = 'pending'` — so concurrent
joins from one installation cannot create duplicate pending rows even when
they race past the handler's existence check: the losing insert maps the
unique violation to the same result as the sequential case,
`409 {"error": "pending request"}` (never a 500).

Denied requests are history: the index covers only `status = 'pending'`, so a
denied user submits a **new** pending row (a new `invite` id) without
reopening the denied one. Because duplicates are impossible by construction,
the owner's `GET /farms/:farmId/invites` (which lists only `pending` rows)
never contains two active requests for the same user.

### Accepting a join request

`POST /invites/:inviteId/accept` resolves a pending request in a single
batch whose statements are each conditional, so racing accepts are safe
without interactive transactions (D1 has none): the membership row is only
inserted while the farm has room, the caller is not already a member, and the
invite is still pending; the invite flips to `accepted` only while it is still
pending *and* the membership exists. Exactly one racing accept performs the
transition and gets `200 {"invite": {..., "status": "accepted"}}`; the loser
gets a deterministic conflict that matches the sequential equivalent —
`409 {"error": "invite_not_pending"}` when a concurrent request already
resolved the invite (same as a repeat accept), `409 {"error": "farm_full", "max": 16}`
when the capacity guard blocked the insert. The losing request's invite stays
`pending` and no membership is created, so acceptance result and membership
state always agree.

## Cloud save sync

Migration `0004_player_saves.sql` creates `player_saves` (one row per player per
farm; see `specs/farm-crosssync-25/systems/cloud-save-sync.md`). The R2 key
layout is defined once in `src/saves.ts` (`saveObjectKey`):

```
farms/{farm_id}/players/{user_id}/save
```

Every saves endpoint from the spec is registered behind bearer-token auth:

- `GET /farms/:farmId/saves`, `POST /saves/upload-authorize`,
  `POST /saves/upload-complete`, `POST /saves/:playerId/download-authorize`
  — implemented

### Listing saves

`GET /farms/:farmId/saves` — requires auth and membership of `farmId` (403
otherwise). Returns `{ saves: [...] }`, each row
`{ user_id, display_name, save_name, file_size, sha256, uploaded_at, object_key }`
ordered by most recent upload. A farm with no uploads is `200 { "saves": [] }`,
not an error. The desktop farm screen polls this endpoint every 20 s while open.

### Uploading a save

Save bytes never pass through the Worker: the client PUTs the archive straight
to R2 using the authorization below, then reports completion. The Worker only
signs the URL and reads object metadata (`BUCKET.head`) to confirm the put
landed — no route accepts or forwards the archive body.

`POST /saves/upload-authorize` — body `{ farmId, objectKey? }`. Requires auth and
membership of `farmId` (403 otherwise). The slot is always the caller's own
(`saveObjectKey(farmId, callerId)`); naming any other key is 403. Returns
`{ authorization: { objectKey, url, method: "PUT", headers, expiresAt } }` and
writes nothing, so an authorize without a matching complete leaves the previous
cloud save authoritative.

`POST /saves/upload-complete` — body
`{ farmId, objectKey?, saveName, fileSize, sha256 }`. Re-checks auth,
membership, and that `objectKey` is the caller's own (403); then verifies the
stored object before any write:

- object missing in R2 → `404 {"error": "object not found"}`;
- object larger than the configured maximum →
  `413 {"error": "object_too_large", "max": <bytes>}`;
- `object.size` (from `BUCKET.head`) differs from the reported `fileSize` →
  `409 {"error": "size_mismatch", "objectSize": <bytes>, "reportedSize": <bytes>}`;
- malformed metadata (empty `saveName`, non-integer/negative `fileSize`,
  `sha256` not 64 hex chars) → `400` with a descriptive `error`.

Every rejection returns before the upsert, so a missing, oversized, or
mismatched upload never replaces the previous authoritative `player_saves`
row (the upsert itself is a single atomic `INSERT ... ON CONFLICT` statement,
which replaces at most one row). On success the route upserts `player_saves`
for `(farm_id, user_id)` and returns `{ save: {...} }`.

**Maximum save size** is configurable per deployment with the `MAX_SAVE_SIZE_BYTES`
env var (a plain wrangler var/secret, decimal bytes). Unset or invalid values
fall back to `DEFAULT_MAX_SAVE_SIZE_BYTES` (512 MiB, `src/saves.ts`) — a
documented default, well above the spec's ~200 MB warning threshold, so the
cap only rejects implausible objects until a deployment tightens it.

**Content-hash trust boundary:** `sha256` is **client-asserted and NOT
verified by the Worker**. The archive bytes move directly between the client
and R2, so the Worker never sees them; it stores the claimed hash as metadata
only. This is a deliberate trust boundary: integrity is enforced at download
time by the downloading client, which verifies the stored `sha256` against the
extracted archive (see "Downloading a save"). A lying uploader can record a
false hash, but every downloader detects it before touching local saves.

### Downloading a save

`POST /saves/:playerId/download-authorize` — body `{ farmId }`. Requires auth and
membership of `farmId` (403 otherwise); `:playerId` names whose save. The target
must also be a member of the farm (404) with a `player_saves` row (404). Returns
`{ authorization: { objectKey, url, method: "GET", headers, expiresAt } }`; the
client GETs the archive straight from R2 and verifies the stored `sha256` after
extraction. Any authenticated member may read another member's slot — only the
slot's owner may write it. `npm run download:check` runs the membership/404
matrix end to end.

### Presigned URL mechanism and local-dev limitation

When R2 S3 credentials are configured (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — secrets in `.dev.vars` / `wrangler
secret`), `upload-authorize` returns a real SigV4 presigned PUT URL and
`download-authorize` a presigned GET URL, both scoped to region `auto` and
signed by `presignR2Put`/`presignR2Get` in `src/saves.ts` (validated against
botocore's `S3SigV4QueryAuth` by unit tests). The URL carries `X-Amz-Date` and
`X-Amz-Expires` (900s TTL) and the Worker reports the matching `expiresAt`;
expiry is enforced by R2's S3 API when the URL is used, which local dev cannot
exercise (local R2 is only reachable through the `BUCKET` binding, no SigV4
layer). With no credentials — the local default — both routes return a
documented placeholder with `presigned: false` and a `note`. To exercise the
flow locally, place the object with
`npx wrangler r2 object put farm-crosssync-saves/<objectKey> --file <file>
--local`, then call `upload-complete`. `npm run upload:check` runs the whole
upload flow end to end.

The desktop client's `putToR2` transport (`src/lib/uploadTransport.ts`) detects
the `presigned: false` marker and PUTs the archive to this Worker's dev
`/r2-test/:key` route (see "Development-only R2 test route") instead of the
placeholder URL. Because an object key contains slashes and the route takes a
single segment, the client percent-encodes the whole key (`/` -> `%2F`) and the
Worker decodes it before storing. `npm run upload:e2e` in the desktop repo
drives `runUpload` + the API client + this transport against the local Worker.

## Development-only R2 test route

`PUT /r2-test/:key` and `GET /r2-test/:key` are a local-development affordance
for round-tripping bytes through the `BUCKET` binding without Cloudflare
account credentials. They have no auth and must never be reachable in a
deployed environment. They are protected by a fail-closed stack — every layer
must be satisfied or the request is rejected:

1. **Switch** — `ENABLE_R2_TEST` must be exactly `"true"`. Anything else (the
   default) makes the route return 404, as if unregistered.
2. **Explicit local-only marker** — `FARM_CROSSSYNC_LOCAL_DEV` must be exactly
   `"true"`. This is a declaration that the running Worker is a local dev
   instance; it belongs ONLY in local configuration (below).
3. **Loopback Host** — the request host must be `localhost`, `127.0.0.1`, or
   `[::1]` (any port). A deployed Worker is only ever reached with the public
   zone name as host, so even a misconfigured deployment rejects every request.

Violations of (2) or (3) return `403 {"error": "r2_test_local_only"}` and log a
loud misconfiguration warning.

4. **Key space** — `:key` (URL-decoded) must match
   `farms/{farmId}/players/{userId}/save` with id-shaped segments
   (`[A-Za-z0-9_-]+`), i.e. exactly the shape `saveObjectKey` produces.
   Anything else — other bucket keys, extra segments, or traversal (`..`) —
   returns `400 {"error": "invalid_key"}`. Bare dot-segments never reach the
   route at all: URL parsing collapses them first.

### Local configuration

Local development needs both markers. Either set them in
`FarmCrossSync25-backend/.dev.vars` (gitignored — a convenience for humans,
never committed):

```
ENABLE_R2_TEST=true
FARM_CROSSSYNC_LOCAL_DEV=true
```

or pass them on the `wrangler dev` command line (this is what the scripts do,
so a fresh clone works without `.dev.vars`):

```bash
npx wrangler dev --var ENABLE_R2_TEST:true --var FARM_CROSSSYNC_LOCAL_DEV:true
```

**NEVER set `ENABLE_R2_TEST` or `FARM_CROSSSYNC_LOCAL_DEV` in a deployed
environment** — not in `wrangler.jsonc` `vars`, not via `wrangler secret`.
Layers (2)/(3) reject all traffic even if you do, and the deploy-time guard
makes it loud.

### Deploy-time guard

`npm run deploy` runs `scripts/deploy-guard.mjs` before `wrangler deploy`. The
guard parses `wrangler.jsonc` (or `wrangler.json`; `wrangler.toml` is scanned
for the names) and aborts the deploy if any `vars` block — top level or
per-environment — sets `ENABLE_R2_TEST` or `FARM_CROSSSYNC_LOCAL_DEV`. It
fails closed on an unparsable config, so a production deploy with the var set
fails loudly rather than silently exposing the backdoor.

## R2 simulation approach

**Chosen: Wrangler/Miniflare's built-in local R2 simulation** (`wrangler dev`,
local by default). Objects are stored under `.wrangler/state/v3/r2/`. No
Docker, MinIO, or custom S3 stand-in is used — the built-in simulation
satisfies byte-exact put/get through the `BUCKET` binding, which is all local
development needs. The SPEC.md open question is resolved in favour of the
in-process simulation.

## R2 round-trip check

With the stack down, run:

```bash
npm run r2:check
```

The script starts the local Worker with `--var ENABLE_R2_TEST:true --var
FARM_CROSSSYNC_LOCAL_DEV:true`, PUTs 4096 random bytes and GETs them back
through the `BUCKET` binding (key
`farms/roundtrip-check/players/roundtrip-check/save`, percent-encoded exactly
like the desktop client's dev fallback), and compares them byte-for-byte.
Expected:

```
PASS: R2 round-trip bytes unchanged (4096 bytes)
```

The check uses the dev-only `/r2-test/:key` routes; see "Development-only R2
test route" for the fail-closed gate (env markers, loopback host, key shape,
and the deploy-time guard that keeps a deployed Worker from ever exposing
them).
