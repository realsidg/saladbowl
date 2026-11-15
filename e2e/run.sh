#!/usr/bin/env bash
# End-to-end run: builds, starts the real server under portless, plays a full game with playwright-cli.
set -euo pipefail
cd "$(dirname "$0")/.."
SCRIPT="${1:-e2e/game.js}"
EXPECT="${2:-E2E PASS}"
npm run build >/dev/null
DATA=$(mktemp -d)
HASH=$(cd server && npx tsx -e 'import("./src/auth/password.ts").then(async (m) => console.log(await m.hashPassword("let-me-in-please")))')
export SALADBOWL_PASSWORD_HASH="$HASH"
export SALADBOWL_SESSION_SECRET="$(head -c 32 /dev/urandom | base64)"
export PUBLIC_ORIGIN="http://saladbowl.gs.localhost:1355,https://saladbowl.gs.localhost"
export COOKIE_SECURE=false DATA_DIR="$DATA" STATIC_DIR="$PWD/web/dist" NODE_ENV=production
portless saladbowl node server/dist/index.js > "$DATA/server.log" 2>&1 &
SERVER=$!
cleanup() {
  playwright-cli -s=saladbowl-e2e close >/dev/null 2>&1 || true
  kill "$SERVER" 2>/dev/null || true
  wait "$SERVER" 2>/dev/null || true
  rm -rf "$DATA"
}
trap cleanup EXIT
for _ in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: saladbowl.gs.localhost' http://127.0.0.1:1355/healthz || true)
  [ "$code" = 200 ] && break
  sleep 0.2
done
[ "$code" = 200 ] || { echo "server did not start"; cat "$DATA/server.log"; exit 1; }
playwright-cli -s=saladbowl-e2e open >/dev/null
OUT=$(playwright-cli -s=saladbowl-e2e --raw run-code --filename="$SCRIPT" 2>&1 || true)
echo "$OUT"
grep -q "$EXPECT" <<<"$OUT" || { echo "--- server log (tail) ---"; tail -20 "$DATA/server.log"; exit 1; }
