#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-empty-guidance"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Init and rebuild
"${PMEM[@]}" init test-v06-empty --description "x" --stage "y" --next "z"
"${PMEM[@]}" rebuild >/dev/null

# update --suggest should output next_steps in JSON
set +e
SUGGEST_OUTPUT="$("${PMEM[@]}" update --suggest --format json 2>&1)"
SUGGEST_CODE="$?"
set -e

# update --suggest with no changes exits 0 (no suggestions), but the JSON should still contain next_steps
if ! echo "$SUGGEST_OUTPUT" | grep -q "next_steps"; then
  echo "FAIL: update --suggest output missing next_steps array"
  echo "$SUGGEST_OUTPUT"
  exit 1
fi

# ask with a nonexistent query should output next_steps in JSON
ASK_OUTPUT="$("${PMEM[@]}" ask "nonexistent" --format json 2>&1)" || true
if ! echo "$ASK_OUTPUT" | grep -q "next_steps"; then
  echo "FAIL: ask 'nonexistent' output missing next_steps array"
  echo "$ASK_OUTPUT"
  exit 1
fi

# Clean up
rm -rf "$PROJECT"

echo "empty guidance passed"
