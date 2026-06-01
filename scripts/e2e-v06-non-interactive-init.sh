#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-non-interactive-init"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Non-interactive init with --guided and explicit arguments
"${PMEM[@]}" init test-v06-init --guided --description "E2E test" --stage "Alpha" --next "Run tests"

# Verify .pmem/ directory exists
test -d .pmem || { echo "FAIL: .pmem/ directory not created"; exit 1; }

# Verify index.md contains the description
grep -q "E2E test" .pmem/index.md || { echo "FAIL: index.md missing description 'E2E test'"; exit 1; }

# Rebuild and verify core commands work
"${PMEM[@]}" rebuild >/dev/null
"${PMEM[@]}" recall --format compact >/dev/null
"${PMEM[@]}" verify >/dev/null

# Clean up
rm -rf "$PROJECT"

echo "non-interactive init passed"
