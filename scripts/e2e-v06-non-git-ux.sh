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

# Init a project and create a mapped source/card pair.
"${PMEM[@]}" init test-v06-nongit --description "x" --stage "y" --next "z" >/dev/null
mkdir -p src .pmem/modules
cat > src/core.ts <<'SRC'
export const value = 1;
SRC
cat > .pmem/modules/module.core.md <<'CARD'
---
id: module.core
type: module
source_files: [src/core.ts]
---
# Core
CARD
"${PMEM[@]}" rebuild >/dev/null

# Status is intentionally called first: it must not consume the mtime change.
STATUS_OUTPUT="$("${PMEM[@]}" status --format json)"
echo "$STATUS_OUTPUT" | grep -q '"source": "mtime"'
echo "$STATUS_OUTPUT" | grep -q 'src/core.ts'

# mark-dirty --auto must use the same mtime snapshot and succeed.
set +e
DIRTY_OUTPUT="$("${PMEM[@]}" mark-dirty --auto --format json 2>&1)"
DIRTY_CODE="$?"
set -e

# Output should NOT contain a raw stack trace (no "at " lines from Node.js)
if echo "$DIRTY_OUTPUT" | grep -q "Error:" && echo "$DIRTY_OUTPUT" | grep -qE "^[[:space:]]*at "; then
  echo "FAIL: mark-dirty --auto output contains raw stack trace"
  echo "$DIRTY_OUTPUT"
  exit 1
fi

if [ "$DIRTY_CODE" -ne 0 ]; then
  echo "FAIL: mark-dirty --auto should succeed outside git"
  echo "$DIRTY_OUTPUT"
  exit 1
fi

echo "$DIRTY_OUTPUT" | grep -q '"state": "marked_dirty"'
echo "$DIRTY_OUTPUT" | grep -q '"module.core"'
echo "$DIRTY_OUTPUT" | grep -q '"src/core.ts"'

rm -rf "$PROJECT"
echo "non-git ux passed"
