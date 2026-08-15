#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

command -v uv >/dev/null 2>&1 || {
  printf 'uv is required to create a locked runtime artifact.\n' >&2
  exit 1
}

cd "$ROOT_DIR"
uv lock --locked
uv build --out-dir "$DIST_DIR"

printf 'Runtime artifacts created in %s\n' "$DIST_DIR"
sha256sum "$DIST_DIR"/* > "$DIST_DIR/SHA256SUMS"
