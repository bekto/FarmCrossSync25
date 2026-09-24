# 27: Download authorize

**What to build:** Worker-side download authorization giving any authenticated farm member short-lived read access to another member's save object.

**Priority:** P0

**Blocked by:** 25

**Status:** done

- [x] `download-authorize` issues temporary read authorization to any authenticated member of the farm
- [x] A non-member gets 403
- [x] A member cannot receive authorization for a farm they do not belong to
- [x] Expired authorizations are rejected

## Work Log
- Done: `POST /saves/:playerId/download-authorize` (member-gated; target-membership 404; missing save 404) returns presigned GET auth via shared `presignR2` + `presignR2Get` in `saves.ts`; TTL 900s. `npm test` 28/28, `npm run download:check` 7/7.
- Assumption: body `{farmId}`; criterion 4 expiry is enforced by R2's S3 layer (not exercisable in local dev) — only URL/expiry computation is unit-tested. No-creds placeholder mirrors upload.
