#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v07-sync-flow"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e-sync@example.com"
git config user.name "pmem e2e sync"

# 1. Initialize project
"${PMEM[@]}" init e2e-v07-sync-flow >/dev/null

mkdir -p src .pmem/modules
cat > src/index.ts <<'SRC'
export const value = 1;
SRC

cat > .pmem/modules/core.md <<'CARD'
---
id: module.core
type: module
title: "Core"
status: active
updated: "2026-06-01T00:00:00.000Z"
source_files:
  - src/index.ts
---

# Core

## Purpose
Main test module for the pmem sync E2E.
CARD

# 2. Build indexes and commit baseline
"${PMEM[@]}" rebuild >/dev/null
git add .
git commit -q -m "baseline commit"

# Verify baseline is clean
"${PMEM[@]}" verify >/dev/null

# 3. Modify source file
cat > src/index.ts <<'SRC'
export const value = 2;
SRC

# Verify status lists change
"${PMEM[@]}" status --format json | grep -q "src/index.ts"

# 4. Run pmem sync without summary
SYNC_OUTPUT="$("${PMEM[@]}" sync)"
echo "$SYNC_OUTPUT" | grep -q "Auto-marked 1 card(s) as dirty"
echo "$SYNC_OUTPUT" | grep -q "Recommended: run \`pmem sync -s"

# Check manifest dirty state is true
grep -q "dirty: true" .pmem/manifest.yml
test -f .pmem/.dirty

# 5. Run pmem sync with summary and next steps
SYNC_CONFIRM_OUTPUT="$("${PMEM[@]}" sync -s "Update index value to 2" -n "Build client components")"
echo "$SYNC_CONFIRM_OUTPUT" | grep -q "Memory sync and update completed"

# Check manifest dirty state is cleared
grep -q "dirty: false" .pmem/manifest.yml
test ! -f .pmem/.dirty

# Check next steps updated
grep -q "Build client components" .pmem/next.md

# Check trace file created
test -d .pmem/traces
TRACES_COUNT=$(ls .pmem/traces/*.md | wc -l | tr -d ' ')
if [ "$TRACES_COUNT" -ne 1 ]; then
  echo "Expected exactly 1 trace file created, got: $TRACES_COUNT"
  exit 1
fi

# Run verify --fix-stale to auto-fix the stale warning (testing Task 3 in E2E)
"${PMEM[@]}" verify --fix-stale >/dev/null


# 6. Run verify to ensure score is 100/100
VERIFY_OUTPUT="$("${PMEM[@]}" verify)"
echo "$VERIFY_OUTPUT" | grep -q "Memory verification passed"
echo "$VERIFY_OUTPUT" | grep -q "Score: 100/100"

echo "✓ E2E v0.7.1 pmem sync flow passed successfully!"
