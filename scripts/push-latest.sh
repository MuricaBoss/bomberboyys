#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MESSAGE="${1:-Update deploy}"

cd "$ROOT_DIR"
if git diff --cached --quiet; then
  echo "Ei staged muutoksia."
  exit 1
fi
git commit -m "$MESSAGE"
git push origin main
