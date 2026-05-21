#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-non-git-ux"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Verify we are NOT inside a git repo
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FAIL: test directory is inside a git repo — non-git test invalid"
  exit 1
fi

# Init a project and create a basic DB so mark-dirty --auto can check for git
"${PMEM[@]}" init test-v06-nongit --description "x" --stage "y" --next "z" >/dev/null
"${PMEM[@]}" rebuild >/dev/null

# mark-dirty --auto in non-git context: may exit non-zero, but must not show a raw stack trace
set +e
DIRTY_OUTPUT="$("${PMEM[@]}" mark-dirty --auto 2>&1)"
DIRTY_CODE="$?"
set -e

# Output should NOT contain a raw stack trace (no "at " lines from Node.js)
if echo "$DIRTY_OUTPUT" | grep -q "Error:" && echo "$DIRTY_OUTPUT" | grep -qE "^[[:space:]]*at "; then
  echo "FAIL: mark-dirty --auto output contains raw stack trace"
  echo "$DIRTY_OUTPUT"
  exit 1
fi

# Output should contain guidance about git
if ! echo "$DIRTY_OUTPUT" | grep -qi "git"; then
  echo "FAIL: mark-dirty --auto output missing git guidance"
  echo "$DIRTY_OUTPUT"
  exit 1
fi

rm -rf "$PROJECT"
echo "non-git ux passed"
