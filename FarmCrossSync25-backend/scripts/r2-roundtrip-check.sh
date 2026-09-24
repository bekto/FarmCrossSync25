#!/usr/bin/env bash
# Starts the local Worker and PUTs then GETs random bytes through the R2
# binding, asserting the returned bytes match. No Cloudflare account needed.
set -euo pipefail

PORT="${PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
KEY="roundtrip-check"

SRC="$(mktemp)"
OUT="$(mktemp)"
LOG="$(mktemp)"
cleanup() {
  kill -- "-${PID}" 2>/dev/null || true
  rm -f "$SRC" "$OUT" "$LOG"
}
trap cleanup EXIT

cd "$(dirname "$0")/.."
setsid npx wrangler dev --port "$PORT" --var ENABLE_R2_TEST:true >"$LOG" 2>&1 &
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

head -c 4096 /dev/urandom >"$SRC"
curl -sf -X PUT --data-binary @"$SRC" "$BASE/r2-test/$KEY" >/dev/null
curl -sf "$BASE/r2-test/$KEY" -o "$OUT"

if cmp -s "$SRC" "$OUT"; then
  echo "PASS: R2 round-trip bytes unchanged ($(wc -c <"$SRC") bytes)"
else
  echo "FAIL: R2 round-trip bytes differ" >&2
  exit 1
fi
