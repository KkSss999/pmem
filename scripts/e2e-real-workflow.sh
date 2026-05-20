#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-real-workflow"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"

"${PMEM[@]}" init e2e-real-workflow >/dev/null

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
Main test module for the pmem real workflow E2E.
CARD

"${PMEM[@]}" rebuild >/dev/null
"${PMEM[@]}" recall --format compact --budget 2000 | grep -q ".pmem/modules/core.md"
"${PMEM[@]}" ask "core" --format json | grep -q "module.core"
"${PMEM[@]}" verify >/dev/null

git add .
git commit -q -m "baseline"

cat > src/index.ts <<'SRC'
export const value = 2;
SRC

"${PMEM[@]}" status --format json | grep -q "src/index.ts"
"${PMEM[@]}" mark-dirty --auto | grep -q "Auto-marked"

set +e
SUGGEST_OUTPUT="$("${PMEM[@]}" update --suggest --format json)"
SUGGEST_CODE="$?"
set -e

if [[ "$SUGGEST_CODE" != "1" ]]; then
  echo "expected update --suggest to exit 1 when suggestions exist, got $SUGGEST_CODE"
  echo "$SUGGEST_OUTPUT"
  exit 1
fi

echo "$SUGGEST_OUTPUT" | grep -q "suggestions"

"${PMEM[@]}" update --confirm -s "Updated core module" -n "Continue testing pmem workflow" >/dev/null
"${PMEM[@]}" verify >/dev/null

echo "real workflow passed"
