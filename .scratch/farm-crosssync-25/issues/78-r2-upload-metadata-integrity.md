# 78: Validate R2 upload metadata and object integrity

**What to build:** Ensure a completed upload records metadata that matches the object actually stored in R2 and reject implausible or mismatched uploads.

**Priority:** P0

**Blocked by:** 77

**Status:** done

- [x] Upload completion verifies that the expected object exists and has the expected byte size.
- [x] Objects exceeding the configured maximum size are rejected.
- [x] Missing, malformed, or mismatched metadata does not replace the previous authoritative save metadata.
- [x] The behavior of client-supplied content hashes is documented as either verified or an explicit trust boundary.

**Verify:** Run backend upload authorization tests with missing, incorrect-size, oversized, and valid objects.

## Work Log

`POST /saves/upload-complete` now verifies the stored object against the report
before any write (FarmCrossSync25-backend/src/index.ts:695-718, after the
existing 400 metadata validation and 403 membership/slot checks and the
existing `BUCKET.head` 404): `object.size > max` → `413 {"error":"object_too_large","max":<bytes>}`
(src/index.ts:706-709); `object.size !== fileSize` →
`409 {"error":"size_mismatch","objectSize":<bytes>,"reportedSize":<bytes>}`
(src/index.ts:710-718). Both, plus the existing `404 {"error":"object not found"}`
and all 400 malformed-metadata paths, return before the upsert, so the
previous `player_saves` row is never replaced on rejection; the upsert itself
is one atomic `INSERT ... ON CONFLICT(farm_id,user_id) DO UPDATE` statement
(src/index.ts:720-728) that replaces at most one row (no fan-out to delete).

Configurable maximum: `DEFAULT_MAX_SAVE_SIZE_BYTES = 512 MiB`
(src/saves.ts:145) with `maxSaveSizeBytes(env)` (src/saves.ts:147-156) reading
the `MAX_SAVE_SIZE_BYTES` env var (decimal bytes; unset/invalid falls back to
the documented default — the pre-existing behaviour had no cap, so a
documented default constant is used rather than fail-closed-unset). 512 MiB
sits well above the spec's ~200 MB warn-but-proceed threshold
(specs/farm-crosssync-25/systems/cloud-save-sync.md). Documented in backend
README "Uploading a save" (error codes + "Maximum save size" paragraph).

Content hashes: documented as an explicit **trust boundary** — `sha256` is
client-asserted and NOT verified by the Worker (bytes move client↔R2
directly; the Worker stores the claimed hash as metadata only). Integrity is
enforced at download time by the downloading client, which verifies the stored
`sha256` after extraction (backend README "Content-hash trust boundary").

Tests (src/upload-integrity.test.mjs, in `npm test`): valid object accepted and
replaces the row; missing object → 404 and previous row survives (byte-for-byte
incl. `uploaded_at`); incorrect size → 409 `size_mismatch` with
`objectSize`/`reportedSize` and previous row survives; oversized object (env
cap 8 B, object 10 B) → 413 `object_too_large` with `max`, previous row
survives, and oversized wins over a mismatching report; malformed metadata
(bad/empty sha256, negative/fractional/string fileSize, blank saveName) → 400
before any write; `maxSaveSizeBytes` default/config/invalid-value behaviour.
Evidence: `node --test src/upload-integrity.test.mjs` → 7 tests / 7 pass /
0 fail.
