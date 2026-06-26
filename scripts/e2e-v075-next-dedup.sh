#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v075-next-dedup"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e-ux@example.com"
git config user.name "pmem e2e ux"

# 1. Initialize project
"${PMEM[@]}" init my-test --guided --description "Next Dedup Test" --stage "Prototype" --next "Step A" >/dev/null

touch README.md
git add .
git commit -m "initial commit" -q

# Assert next.md has one managed block and contains "Step A"
test -f .pmem/next.md
grep -c "pmem:next:start" .pmem/next.md | grep -q "^1$"
grep -c "pmem:next:end" .pmem/next.md | grep -q "^1$"
grep -q "Step A" .pmem/next.md

# 2. Modify a file and run capture to update next step to "Step B"
mkdir -p src
cat > src/App.jsx <<'SRC'
export const x = 1;
SRC

"${PMEM[@]}" capture --auto -s "Update step to B" -n "Step B"

git add .
git commit -m "add x" -q

# Assert next.md has exactly one managed block and contains "Step B", and "Step A" is gone or at least only "Step B" is under the managed block
grep -c "pmem:next:start" .pmem/next.md | grep -q "^1$"
grep -c "pmem:next:end" .pmem/next.md | grep -q "^1$"
grep -q "Step B" .pmem/next.md

# 3. Call update command to update next step to "Step C"
"${PMEM[@]}" update --confirm -s "Manual update" -n "Step C"

# Assert next.md has exactly one managed block and contains "Step C"
grep -c "pmem:next:start" .pmem/next.md | grep -q "^1$"
grep -c "pmem:next:end" .pmem/next.md | grep -q "^1$"
grep -q "Step C" .pmem/next.md

echo "✓ E2E next.md de-duplication test passed successfully!"
