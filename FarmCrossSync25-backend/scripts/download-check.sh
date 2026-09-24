#!/usr/bin/env bash
# Exercises download-authorize against the local Worker + D1 + R2: membership
# gates (member 200, non-member / other-farm member 403), target membership and
# save-row 404s, and the shape of the returned GET authorization. No S3
# credentials needed: with none configured the route returns a documented
# presigned=false placeholder, exactly like upload-check.sh.
set -euo pipefail

PORT="${PORT:-8790}"
BASE="http://127.0.0.1:${PORT}"
DB="farm-crosssync-db"
BUCKET="farm-crosssync-saves"
LOG="$(mktemp)"
SRC="$(mktemp)"
BODY="$(mktemp)"
PID=""

cleanup() {
  [ -n "$PID" ] && kill -- "-$PID" 2>/dev/null || true
  rm -f "$LOG" "$SRC" "$BODY"
}
trap cleanup EXIT

cd "$(dirname "$0")/.."

json() { node -e "process.stdout.write(String(JSON.parse(process.argv[1])$2))" "$1" "$2"; }
code() { curl -s -o "$BODY" -w '%{http_code}' "$@"; }

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
OTHER_REG="$(register "other-$STAMP" Other)"
OTHER_TOKEN="$(json "$OTHER_REG" ".token")"

FARM="$(curl -sf -X POST "$BASE/farms" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Download Farm"}')"
FARM_ID="$(json "$FARM" ".farm.id")"
FARM_CODE="$(json "$FARM" ".farm.code")"

# Second farm owned by OTHER: OTHER is a member of a different farm, not this one.
OTHER_FARM="$(curl -sf -X POST "$BASE/farms" -H "Authorization: Bearer $OTHER_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Other Farm"}')"
OTHER_FARM_ID="$(json "$OTHER_FARM" ".farm.id")"
echo "farm: $FARM_ID ($FARM_CODE); other farm: $OTHER_FARM_ID"

# Bring MEMBER in via join request + owner accept.
curl -sf -X POST "$BASE/farms/$FARM_ID/join" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"code\":\"$FARM_CODE\"}" >/dev/null
INVITE="$(curl -sf "$BASE/farms/$FARM_ID/invites" -H "Authorization: Bearer $OWNER_TOKEN")"
INVITE_ID="$(json "$INVITE" ".invites[0].id")"
curl -sf -X POST "$BASE/invites/$INVITE_ID/accept" -H "Authorization: Bearer $OWNER_TOKEN" >/dev/null
echo "members: owner=$OWNER_ID member=$MEMBER_ID"

# Seed the owner's save the same way ticket 26 does: authorize, put to local R2,
# then complete to create the player_saves row.
OWNER_KEY="farms/$FARM_ID/players/$OWNER_ID/save"
curl -sf -X POST "$BASE/saves/upload-authorize" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}" >/dev/null
head -c 1024 /dev/urandom >"$SRC"
SHA="$(sha256sum "$SRC" | cut -d' ' -f1)"
SIZE="$(wc -c <"$SRC" | tr -d ' ')"
npx wrangler r2 object put "$BUCKET/$OWNER_KEY" --file "$SRC" --local >/dev/null
curl -sf -X POST "$BASE/saves/upload-complete" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"objectKey\":\"$OWNER_KEY\",\"saveName\":\"Owner Save\",\"fileSize\":$SIZE,\"sha256\":\"$SHA\"}" >/dev/null

# 1. A member may authorize a download of the owner's save.
C="$(code -X POST "$BASE/saves/$OWNER_ID/download-authorize" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "200" ] || { echo "FAIL: member download-authorize -> $C: $(cat "$BODY")"; exit 1; }
AUTH="$(cat "$BODY")"
[ "$(json "$AUTH" ".authorization.objectKey")" = "$OWNER_KEY" ] \
  || { echo "FAIL: wrong objectKey: $AUTH"; exit 1; }
[ "$(json "$AUTH" ".authorization.method")" = "GET" ] \
  || { echo "FAIL: method not GET: $AUTH"; exit 1; }
EXPIRES_AT="$(json "$AUTH" ".authorization.expiresAt")"
[ -n "$EXPIRES_AT" ] || { echo "FAIL: no expiresAt: $AUTH"; exit 1; }
echo "PASS: member download-authorize for owner's save -> 200 GET $OWNER_KEY (expires $EXPIRES_AT)"

# Missing farmId -> 400.
C="$(code -X POST "$BASE/saves/$OWNER_ID/download-authorize" -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H 'content-type: application/json' -d '{}')"
[ "$C" = "400" ] && echo "PASS: missing farmId -> 400" || { echo "FAIL: missing farmId -> $C"; exit 1; }

# Missing auth -> 401.
C="$(code -X POST "$BASE/saves/$OWNER_ID/download-authorize" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "401" ] && echo "PASS: no token -> 401" || { echo "FAIL: no token -> $C"; exit 1; }

# 2. A non-member of the farm -> 403.
C="$(code -X POST "$BASE/saves/$OWNER_ID/download-authorize" -H "Authorization: Bearer $OUTSIDER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "403" ] && echo "PASS: non-member -> 403" || { echo "FAIL: non-member -> $C"; exit 1; }

# 3. A member of a different farm may not authorize this farm's save -> 403.
C="$(code -X POST "$BASE/saves/$OWNER_ID/download-authorize" -H "Authorization: Bearer $OTHER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "403" ] && echo "PASS: member of another farm -> 403" || { echo "FAIL: other-farm member -> $C"; exit 1; }

# Target is a member but never uploaded -> 404.
C="$(code -X POST "$BASE/saves/$MEMBER_ID/download-authorize" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "404" ] && echo "PASS: target with no save -> 404" || { echo "FAIL: missing save -> $C"; exit 1; }

# Target is not a member of the farm -> 404.
NOSUCH="no-such-player-$STAMP"
C="$(code -X POST "$BASE/saves/$NOSUCH/download-authorize" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' -d "{\"farmId\":\"$FARM_ID\"}")"
[ "$C" = "404" ] && echo "PASS: target not a member -> 404" || { echo "FAIL: target not member -> $C"; exit 1; }

echo "ALL DOWNLOAD CHECKS PASSED"
