#!/usr/bin/env bash
# Exercises the two-phase direct-to-R2 upload against the local Worker + D1 + R2:
# auth/membership/ownership on upload-authorize, metadata upsert + slot replace
# on upload-complete, and that authorize alone never touches player_saves.
# No Cloudflare account or S3 credentials needed: the direct put is simulated
# with `wrangler r2 object put --local`.
set -euo pipefail

PORT="${PORT:-8789}"
BASE="http://127.0.0.1:${PORT}"
DB="farm-crosssync-db"
BUCKET="farm-crosssync-saves"
LOG="$(mktemp)"
SRC1="$(mktemp)"
SRC2="$(mktemp)"
BODY="$(mktemp)"
PID=""

cleanup() {
  [ -n "$PID" ] && kill -- "-$PID" 2>/dev/null || true
  rm -f "$LOG" "$SRC1" "$SRC2" "$BODY"
}
trap cleanup EXIT

cd "$(dirname "$0")/.."

json() { node -e "process.stdout.write(String(JSON.parse(process.argv[1])$2))" "$1" "$2"; }
code() { curl -s -o "$BODY" -w '%{http_code}' "$@"; }
saves_count() {
  npx wrangler d1 execute DB --local --json \
    --command "SELECT COUNT(*) AS n FROM player_saves WHERE farm_id='$1' AND user_id='$2'" 2>/dev/null |
    node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].results[0].n))"
}
saves_sha() {
  npx wrangler d1 execute DB --local --json \
    --command "SELECT sha256, uploaded_at FROM player_saves WHERE farm_id='$1' AND user_id='$2'" 2>/dev/null |
    node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].results[0]))"
}

npx wrangler d1 migrations apply DB --local >/dev/null

setsid npx wrangler dev --port "$PORT" >"$LOG" 2>&1 &
PID=$!

for _ in $(seq 1 60); do
  curl -sf "$BASE/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "$BASE/health" >/dev/null 2>&1; then
  echo "FAIL: Worker did not start on $BASE" >&2
  cat "$LOG" >&2
  exit 1
fi

STAMP="$(date +%s%N)"
register() {
  curl -sf -X POST "$BASE/register" -H 'content-type: application/json' \
    -d "{\"installationId\":\"$1\",\"displayName\":\"$2\"}"
}

OWNER_REG="$(register "owner-$STAMP" Owner)"
OWNER_TOKEN="$(json "$OWNER_REG" ".token")"
OWNER_ID="$(json "$OWNER_REG" ".user.id")"
MEMBER_REG="$(register "member-$STAMP" Member)"
MEMBER_TOKEN="$(json "$MEMBER_REG" ".token")"
MEMBER_ID="$(json "$MEMBER_REG" ".user.id")"
OUTSIDER_REG="$(register "outsider-$STAMP" Outsider)"
OUTSIDER_TOKEN="$(json "$OUTSIDER_REG" ".token")"
MEMBER2_REG="$(register "member2-$STAMP" Member2)"
MEMBER2_TOKEN="$(json "$MEMBER2_REG" ".token")"
MEMBER2_ID="$(json "$MEMBER2_REG" ".user.id")"

FARM="$(curl -sf -X POST "$BASE/farms" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Upload Farm"}')"
FARM_ID="$(json "$FARM" ".farm.id")"
FARM_CODE="$(json "$FARM" ".farm.code")"
echo "farm: $FARM_ID ($FARM_CODE)"

# Bring the member in via join request + owner accept.
curl -sf -X POST "$BASE/farms/$FARM_ID/join" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"code\":\"$FARM_CODE\"}" >/dev/null
INVITE="$(curl -sf "$BASE/farms/$FARM_ID/invites" -H "Authorization: Bearer $OWNER_TOKEN")"
INVITE_ID="$(json "$INVITE" ".invites[0].id")"
curl -sf -X POST "$BASE/invites/$INVITE_ID/accept" -H "Authorization: Bearer $OWNER_TOKEN" >/dev/null

curl -sf -X POST "$BASE/farms/$FARM_ID/join" -H "Authorization: Bearer $MEMBER2_TOKEN" \
  -H 'content-type: application/json' -d "{\"code\":\"$FARM_CODE\"}" >/dev/null
INVITE2="$(curl -sf "$BASE/farms/$FARM_ID/invites" -H "Authorization: Bearer $OWNER_TOKEN")"
INVITE2_ID="$(json "$INVITE2" ".invites[0].id")"
curl -sf -X POST "$BASE/invites/$INVITE2_ID/accept" -H "Authorization: Bearer $OWNER_TOKEN" >/dev/null
echo "members: owner=$OWNER_ID member=$MEMBER_ID member2=$MEMBER2_ID"

MEMBER_KEY="farms/$FARM_ID/players/$MEMBER_ID/save"

# 1+2. Authorize: non-member -> 403.
C="$(code -X POST "$BASE/saves/upload-authorize" -H "Authorization: Bearer $OUTSIDER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "403" ] && echo "PASS: non-member authorize -> 403" || { echo "FAIL: non-member authorize -> $C"; exit 1; }

# 2. Authorize: naming another user's slot -> 403.
OTHER_KEY="farms/$FARM_ID/players/$OWNER_ID/save"
C="$(code -X POST "$BASE/saves/upload-authorize" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\",\"objectKey\":\"$OTHER_KEY\"}")"
[ "$C" = "403" ] && echo "PASS: authorize another user's slot -> 403" || { echo "FAIL: authorize another slot -> $C"; exit 1; }

# 1. Authorize: own slot -> authorization object (no S3 creds => placeholder).
C="$(code -X POST "$BASE/saves/upload-authorize" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\",\"saveName\":\"My Farm\"}")"
[ "$C" = "200" ] || { echo "FAIL: member authorize -> $C: $(cat "$BODY")"; exit 1; }
AUTH="$(cat "$BODY")"
[ "$(json "$AUTH" ".authorization.objectKey")" = "$MEMBER_KEY" ] \
  && echo "PASS: member authorize for own slot -> 200 $MEMBER_KEY" \
  || { echo "FAIL: wrong objectKey: $AUTH"; exit 1; }
[ "$(json "$AUTH" ".authorization.method")" = "PUT" ] || { echo "FAIL: method not PUT: $AUTH"; exit 1; }
[ "$(json "$AUTH" ".authorization.presigned")" = "false" ] \
  && echo "PASS: no S3 creds -> documented placeholder authorization (presigned=false)" \
  || echo "INFO: presigned authorization returned"
echo "authorization: $AUTH"

# 5. Authorize alone leaves player_saves untouched (no row yet).
[ "$(saves_count "$FARM_ID" "$MEMBER_ID")" = "0" ] \
  && echo "PASS: authorize wrote no player_saves row" \
  || { echo "FAIL: authorize created metadata"; exit 1; }

# 3. Simulate the direct client put, then complete.
head -c 2048 /dev/urandom >"$SRC1"
SHA1="$(sha256sum "$SRC1" | cut -d' ' -f1)"
SIZE1="$(wc -c <"$SRC1" | tr -d ' ')"
npx wrangler r2 object put "$BUCKET/$MEMBER_KEY" --file "$SRC1" --local >/dev/null
C="$(code -X POST "$BASE/saves/upload-complete" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"objectKey\":\"$MEMBER_KEY\",\"saveName\":\"My Farm\",\"fileSize\":$SIZE1,\"sha256\":\"$SHA1\"}")"
[ "$C" = "200" ] || { echo "FAIL: upload-complete -> $C: $(cat "$BODY")"; exit 1; }
[ "$(json "$(cat "$BODY")" ".save.sha256")" = "$SHA1" ] || { echo "FAIL: complete returned wrong sha"; exit 1; }
[ "$(saves_count "$FARM_ID" "$MEMBER_ID")" = "1" ] \
  && echo "PASS: upload-complete created one player_saves row" \
  || { echo "FAIL: expected 1 row"; exit 1; }
ROW1="$(saves_sha "$FARM_ID" "$MEMBER_ID")"
echo "row1: $ROW1"

# 5. A second authorize must not disturb the existing metadata row.
sleep 1
curl -sf -X POST "$BASE/saves/upload-authorize" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}" >/dev/null
ROW1B="$(saves_sha "$FARM_ID" "$MEMBER_ID")"
[ "$ROW1" = "$ROW1B" ] \
  && echo "PASS: authorize after upload left previous metadata authoritative" \
  || { echo "FAIL: authorize changed metadata"; echo "$ROW1"; echo "$ROW1B"; exit 1; }

# 3. Second upload into the same slot replaces the row (count stays 1).
head -c 4096 /dev/urandom >"$SRC2"
SHA2="$(sha256sum "$SRC2" | cut -d' ' -f1)"
SIZE2="$(wc -c <"$SRC2" | tr -d ' ')"
npx wrangler r2 object put "$BUCKET/$MEMBER_KEY" --file "$SRC2" --local >/dev/null
curl -sf -X POST "$BASE/saves/upload-complete" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"objectKey\":\"$MEMBER_KEY\",\"saveName\":\"My Farm v2\",\"fileSize\":$SIZE2,\"sha256\":\"$SHA2\"}" >/dev/null
CNT="$(saves_count "$FARM_ID" "$MEMBER_ID")"
ROW2="$(saves_sha "$FARM_ID" "$MEMBER_ID")"
NODE_SHA="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).sha256)" "$ROW2")"
[ "$CNT" = "1" ] && [ "$NODE_SHA" = "$SHA2" ] && [ "$ROW1" != "$ROW2" ] \
  && echo "PASS: re-upload replaced the slot row (count=1, hash/timestamp updated)" \
  || { echo "FAIL: replace: count=$CNT sha=$NODE_SHA"; echo "$ROW2"; exit 1; }
echo "row2: $ROW2"

# 2. Complete naming another user's slot -> 403.
C="$(code -X POST "$BASE/saves/upload-complete" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"objectKey\":\"$OTHER_KEY\",\"saveName\":\"x\",\"fileSize\":1,\"sha256\":\"$SHA1\"}")"
[ "$C" = "403" ] && echo "PASS: complete another user's slot -> 403" || { echo "FAIL: complete other slot -> $C"; exit 1; }

# Missing R2 object -> 404 (member2 is a member but never put anything).
C="$(code -X POST "$BASE/saves/upload-complete" -H "Authorization: Bearer $MEMBER2_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"saveName\":\"ghost\",\"fileSize\":1,\"sha256\":\"$SHA1\"}")"
[ "$C" = "404" ] && echo "PASS: complete with no R2 object -> 404" || { echo "FAIL: missing object -> $C"; exit 1; }

echo "ALL UPLOAD CHECKS PASSED"
