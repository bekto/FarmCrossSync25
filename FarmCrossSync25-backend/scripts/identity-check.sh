#!/usr/bin/env bash
# Exercises identity: register, idempotent re-register, /me auth, token hashing
# and last_seen_at updates against the local Worker + D1. No account needed.
set -euo pipefail

PORT="${PORT:-8788}"
BASE="http://127.0.0.1:${PORT}"
LOG="$(mktemp)"
PID=""

cleanup() {
  [ -n "$PID" ] && kill -- "-$PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

cd "$(dirname "$0")/.."

json() { node -e "process.stdout.write(String(JSON.parse(process.argv[1])$2))" "$1"; }

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

INSTALL_ID="check-$(date +%s%N)"

REG1="$(curl -sf -X POST "$BASE/register" -H 'content-type: application/json' \
  -d "{\"installationId\":\"$INSTALL_ID\",\"displayName\":\"Checker\"}")"
echo "register#1: $REG1"
TOKEN1="$(json "$REG1" ".token")"
USER1="$(json "$REG1" ".user.id")"

REG2="$(curl -sf -X POST "$BASE/register" -H 'content-type: application/json' \
  -d "{\"installationId\":\"$INSTALL_ID\",\"displayName\":\"Checker\"}")"
echo "register#2: $REG2"
TOKEN2="$(json "$REG2" ".token")"
USER2="$(json "$REG2" ".user.id")"

[ "$USER1" = "$USER2" ] \
  && echo "PASS: re-register returns same user id ($USER1)" \
  || { echo "FAIL: user id changed ($USER1 -> $USER2)"; exit 1; }
[ "$TOKEN1" != "$TOKEN2" ] \
  && echo "PASS: re-register issues a new token" \
  || { echo "FAIL: token was reused"; exit 1; }

ME="$(curl -sf "$BASE/me" -H "Authorization: Bearer $TOKEN1")"
echo "/me: $ME"
[ "$(json "$ME" ".user.id")" = "$USER1" ] \
  && echo "PASS: /me returns current user" \
  || { echo "FAIL: /me returned wrong user"; exit 1; }

CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/me")"
[ "$CODE" = "401" ] \
  && echo "PASS: /me without token -> 401" \
  || { echo "FAIL: /me without token returned $CODE"; exit 1; }
BAD="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/me" -H "Authorization: Bearer not-a-real-token")"
[ "$BAD" = "401" ] \
  && echo "PASS: /me with unknown token -> 401" \
  || { echo "FAIL: /me with unknown token returned $BAD"; exit 1; }

BEFORE="$(json "$ME" ".user.lastSeenAt")"
sleep 1
ME2="$(curl -sf "$BASE/me" -H "Authorization: Bearer $TOKEN2")"
AFTER="$(json "$ME2" ".user.lastSeenAt")"
[ "$AFTER" \> "$BEFORE" ] \
  && echo "PASS: last_seen_at advanced ($BEFORE -> $AFTER)" \
  || { echo "FAIL: last_seen_at did not advance ($BEFORE -> $AFTER)"; exit 1; }

kill -- "-$PID" 2>/dev/null || true
PID=""
for _ in $(seq 1 20); do
  curl -sf "$BASE/health" >/dev/null 2>&1 || break
  sleep 1
done

SESSIONS="$(npx wrangler d1 execute DB --local --json \
  --command "SELECT token_hash, user_id, created_at FROM sessions WHERE user_id='$USER1'" 2>/dev/null)"
echo "sessions rows: $SESSIONS"
if printf '%s' "$SESSIONS" | grep -q "$TOKEN1"; then
  echo "FAIL: raw token found in sessions table" >&2
  exit 1
fi
HASH1="$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$TOKEN1")"
printf '%s' "$SESSIONS" | grep -q "$HASH1" \
  && echo "PASS: sessions stores only the SHA-256 token hash" \
  || { echo "FAIL: expected token hash not found in sessions"; exit 1; }
