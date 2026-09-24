# 26: Upload authorize and complete

**What to build:** Worker-side upload authorization for the caller's own slot and metadata completion after the direct-to-R2 put, replacing any previous save in that slot.

**Priority:** P0

**Blocked by:** 25

**Status:** done

- [x] `upload-authorize` verifies authentication, farm membership, and slot ownership before issuing temporary write authorization
- [x] A non-member or another user's slot gets 403
- [x] `upload-complete` replaces player_saves metadata and any previous entry for that slot
- [x] The Worker never streams save bytes
- [x] An authorize without a complete leaves previous metadata authoritative

## Work Log
- Done: `POST /saves/upload-authorize` (auth + membership + own-slot check, returns `{ authorization: { objectKey, url, method, headers, expiresAt } }`, writes nothing) and `POST /saves/upload-complete` (`BUCKET.head` existence check, `INSERT ... ON CONFLICT(farm_id,user_id) DO UPDATE`, returns `{ save }`) in `src/index.ts`. Added `r2S3Config` + SigV4 `presignR2Put` (region `auto`) to `src/saves.ts`, plus `scripts/upload-check.sh` / `npm run upload:check`. `npm test` 26/26, typecheck clean.
- Verified: `npm test` (presign vector + botocore cross-check), `npm run upload:check` — non-member/other-slot authorize 403, own-slot authorize 200, authorize leaves prior `player_saves` row unchanged, complete creates then replaces the row (count stays 1, hash/uploaded_at updated), mismatched objectKey 403, missing R2 object 404. No wrangler process left running.
- Assumption: no R2 S3 credentials in the environment, so `upload-authorize` returns the documented placeholder (`presigned: false` + `note`); a real presigned URL is returned when `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` are set. Local direct put is simulated with `wrangler r2 object put --local`. Criterion 4: saves routes only call `BUCKET.head`; the byte-streaming `/r2-test/*` routes are pre-existing and disabled unless `ENABLE_R2_TEST=true`. Download/list (tickets 27-28) left as `501` stubs.
