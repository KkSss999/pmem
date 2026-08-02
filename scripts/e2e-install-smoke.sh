#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT/temp/e2e-install-smoke"
PREFIX="$TMP_DIR/npm-prefix"
PROJECT="$TMP_DIR/first-project"

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

EXPECTED_VERSION="$(node -e "console.log(require('./package.json').version)")"
"$PREFIX/bin/pmem" --version | grep -q "$EXPECTED_VERSION"
"$PREFIX/bin/pmem" --help | grep -q "Project Memory"
"$PREFIX/bin/pmem" --help | grep -q "status"
"$PREFIX/bin/pmem" --help | grep -q "session"
"$PREFIX/bin/pmem" semantic enable --help | grep -q "pmem semantic enable"
"$PREFIX/bin/pmem" semantic enable --help | grep -q -- "--source <source>"

mkdir -p "$PROJECT"
cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"
"$PREFIX/bin/pmem" init first-project | tee init-output.txt
grep -q 'pmem is ready for project "first-project"' init-output.txt
test -f .pmem/pmem.db
"$PREFIX/bin/pmem" context "create the first module" --format compact | grep -q "PMEM_CONTEXT_READY"

echo "install and first-project journey passed"
