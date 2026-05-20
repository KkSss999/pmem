#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-non-git-fallback"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Must not be inside a git repo
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FAIL: test directory is inside a git repo — non-git test invalid"
  exit 1
fi

"${PMEM[@]}" init pmem-e2e-non-git >/dev/null

mkdir -p src .pmem/modules
cat > src/index.ts <<'SRC'
export const value = 1;
SRC

cat > .pmem/modules/core.md <<'CARD'
---
id: module.core
type: module
status: active
tags: [core]
aliases: [core]
source_files: [src/index.ts]
---

# Core

## Purpose
Main test module for the pmem non-git fallback E2E.
CARD

"${PMEM[@]}" rebuild >/dev/null

# First status run: no changes yet, establishes .last-status baseline
sleep 1
FIRST_STATUS="$("${PMEM[@]}" status --format json)"
echo "$FIRST_STATUS" | grep -q '"source": "mtime"'

# Verify .last-status was written
test -f .pmem/.last-status || { echo "FAIL: .pmem/.last-status not created"; exit 1; }

# Modify a source file
sleep 1
cat > src/index.ts <<'SRC'
export const value = 2;
SRC

# Second status run: should detect the change via mtime
SECOND_STATUS="$("${PMEM[@]}" status --format json)"
echo "$SECOND_STATUS" | grep -q '"source": "mtime"'
echo "$SECOND_STATUS" | grep -q "src/index.ts"

# Also test verify works in non-git project
"${PMEM[@]}" verify >/dev/null

# Clean up
rm -rf "$PROJECT"

echo "non-git fallback passed"
