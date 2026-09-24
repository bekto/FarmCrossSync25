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

No `.dev.vars` is required. Secrets would go in `.dev.vars` (gitignored); none
are needed for local development yet.

## Farms & membership

Migration `0003_farms.sql` creates `farms`, `farm_members`, and `farm_invites`
(see `specs/farm-crosssync-25/systems/farms-and-membership.md`).

Every farms endpoint from the spec is registered behind bearer-token auth:

- `POST /farms` — create (creator becomes owner)
- `GET /farms/:farmId` — farm detail (stub)
- `POST /farms/:farmId/join` — request to join by code
- `GET /farms/:farmId/invites`, `POST /invites/:inviteId/accept`, `POST /invites/:inviteId/deny` — owner only
- `GET /farms/:farmId/members` — member list (members only; `user_id`, `display_name`, `role`, `joined_at`)
- `DELETE /farms/:farmId/members/:userId` — owner kick, or self-leave
- `POST /farms/:farmId/transfer-owner` — owner hands ownership to a member (body `{ "userId": "..." }`; previous owner stays a member)

The still-unimplemented stub (`GET /farms/:farmId`) returns HTTP `501` with a structured body:

```json
{ "error": "not_implemented", "endpoint": "GET /farms/:farmId" }
```

**Kick = leave.** `DELETE /farms/:farmId/members/:userId` ends the membership,
deletes the target's `player_saves` row, and deletes their R2 object via the
shared `saveObjectKey(farmId, userId)` helper. Any member may delete their own
row (leave); deleting someone else requires the farm owner. **Local saves are
never touched** — the Worker has no filesystem access; local files are a client
concern. When the owner leaves while members remain, the earliest-joined
survivor is promoted to `owner` (the owner may also transfer explicitly).
The last member leaving leaves the farm row in place; the farm cascade is
out of scope here.

**Member cap:** a farm holds a maximum of 16 members. The shared constant is
`MAX_FARM_MEMBERS` in `src/farms.ts`, with `isAtCapacity` / `assertCanAddMember`
guards. Handlers that add members call the guard and reject joins at capacity.
`npm test` covers the 15-ok / 16-rejected boundary.

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
membership, and that `objectKey` is the caller's own (403); verifies the object
exists in R2 (404 if not); then upserts `player_saves` for
`(farm_id, user_id)`, replacing any previous row. Returns `{ save: {...} }`.

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
`/r2-test/:key` route (enabled by `ENABLE_R2_TEST=true`) instead of the
placeholder URL. Because an object key contains slashes and the route takes a
single segment, the client percent-encodes the whole key (`/` -> `%2F`) and the
Worker decodes it before storing. `npm run upload:e2e` in the desktop repo
drives `runUpload` + the API client + this transport against the local Worker.

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

The script starts the local Worker, PUTs 4096 random bytes and GETs them back
through the `BUCKET` binding, and compares them byte-for-byte. Expected:

```
PASS: R2 round-trip bytes unchanged (4096 bytes)
```

The check uses the dev-only `/r2-test/:key` routes, which are disabled unless
`ENABLE_R2_TEST=true` is passed to `wrangler dev` (the script does this, and a
deployed Worker never sets it, so the route returns 404 in production).
