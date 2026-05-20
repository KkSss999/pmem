#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT/temp/e2e-install-smoke"
PREFIX="$TMP_DIR/npm-prefix"

rm -rf "$TMP_DIR"
mkdir -p "$PREFIX"

cd "$ROOT"
npm run build >/dev/null

TARBALL="$(npm pack --silent)"
cleanup() {
  rm -f "$ROOT/$TARBALL"
}
trap cleanup EXIT

npm install -g --prefix "$PREFIX" "$ROOT/$TARBALL" >/dev/null

"$PREFIX/bin/pmem" --version | grep -q "0.5.0"
"$PREFIX/bin/pmem" --help | grep -q "Project Memory"
"$PREFIX/bin/pmem" --help | grep -q "status"
"$PREFIX/bin/pmem" --help | grep -q "session"

echo "install smoke passed"
