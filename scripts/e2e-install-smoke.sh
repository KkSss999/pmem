#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT/temp/e2e-install-smoke"
BUN_INSTALL="$TMP_DIR/bun-install"
PROJECT="$TMP_DIR/first-project"

rm -rf "$TMP_DIR"
mkdir -p "$BUN_INSTALL"

cd "$ROOT"
bun run build >/dev/null

TARBALL="$(bun pm pack --quiet)"
cleanup() {
  rm -f "$ROOT/$TARBALL"
}
trap cleanup EXIT

BUN_INSTALL="$BUN_INSTALL" bun add -g "$ROOT/$TARBALL" >/dev/null

EXPECTED_VERSION="$(node -e "console.log(require('./package.json').version)")"
"$BUN_INSTALL/bin/pmem" --version | grep -q "$EXPECTED_VERSION"
"$BUN_INSTALL/bin/pmem" --help | grep -q "Project Memory"
"$BUN_INSTALL/bin/pmem" --help | grep -q "status"
"$BUN_INSTALL/bin/pmem" --help | grep -q "session"
"$BUN_INSTALL/bin/pmem" semantic enable --help | grep -q "pmem semantic enable"
"$BUN_INSTALL/bin/pmem" semantic enable --help | grep -q -- "--source <source>"

mkdir -p "$PROJECT"
cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"
"$BUN_INSTALL/bin/pmem" init first-project | tee init-output.txt
grep -q 'pmem is ready for project "first-project"' init-output.txt
test -f .pmem/pmem.db
"$BUN_INSTALL/bin/pmem" context "create the first module" --format compact | grep -q "PMEM_CONTEXT_READY"

echo "install and first-project journey passed"
