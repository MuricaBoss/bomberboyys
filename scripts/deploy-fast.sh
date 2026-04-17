#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-root@46.224.175.9}"
SERVER_DIR="${SERVER_DIR:-/opt/bomber-boys}"
PUBLIC_VERSION_URL="${PUBLIC_VERSION_URL:-http://46.224.175.9:4173/version.json}"
MODE="${1:-client}"

say() {
  printf '%s\n' "$1"
}

require_clean_build_number_file() {
  if ! grep -q 'DISPLAY_BUILD_NUMBER' "$ROOT_DIR/client/src/build-meta.ts"; then
    say "Virhe. Build numero ei loydy."
    exit 1
  fi
}

get_build_number() {
  sed -n 's/.*DISPLAY_BUILD_NUMBER = \"\\([0-9][0-9]*\\)\".*/\\1/p' "$ROOT_DIR/client/src/build-meta.ts"
}

require_clean_build_number_file

cd "$ROOT_DIR/client"
node scripts/bump-build-number.mjs >/tmp/bomber-boys-bump.log
BUILD_NUMBER="$(get_build_number)"
say "Menossa. Build $BUILD_NUMBER."

npm run build:ci >/tmp/bomber-boys-client-build.log
say "Client valmis. Build $BUILD_NUMBER."

cd "$ROOT_DIR/server"
npx tsc --noEmit -p tsconfig.json >/tmp/bomber-boys-server-check.log
say "Server check ok. Build $BUILD_NUMBER."

cd "$ROOT_DIR"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  "$ROOT_DIR/" "$SERVER_HOST:$SERVER_DIR/"
say "Sync valmis. Build $BUILD_NUMBER."

if [[ "$MODE" == "full" ]]; then
  ssh "$SERVER_HOST" "cd '$SERVER_DIR' && docker compose up -d --build server client" >/tmp/bomber-boys-deploy.log
  say "Full deploy valmis. Build $BUILD_NUMBER."
else
  ssh "$SERVER_HOST" "cd '$SERVER_DIR' && docker compose up -d --build client" >/tmp/bomber-boys-deploy.log
  say "Client deploy valmis. Build $BUILD_NUMBER."
fi

VERSION_JSON="$(curl -s "$PUBLIC_VERSION_URL")"
say "Versio:"
printf '%s\n' "$VERSION_JSON"

