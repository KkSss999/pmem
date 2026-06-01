#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-answers-file"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Create a JSON answers file
cat > ./answers.json <<'JSON'
{"description": "Answers E2E", "stage": "Beta", "next": "Ship"}
JSON

# Init using the answers file
"${PMEM[@]}" init test-v06-answers --answers ./answers.json

# Verify index.md contains the description from answers file
grep -q "Answers E2E" .pmem/index.md || { echo "FAIL: index.md missing description 'Answers E2E'"; exit 1; }

# Clean up
rm -rf "$PROJECT"

echo "answers file init passed"
