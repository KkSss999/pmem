#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v074-agent-ux"
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
"${PMEM[@]}" init e2e-v074-agent-ux >/dev/null

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
CARD

# Rebuild and baseline commit
"${PMEM[@]}" rebuild >/dev/null
git add .
git commit -q -m "baseline commit"

# 2. Run context command
CONTEXT_OUTPUT="$("${PMEM[@]}" context "Implement Agent UX Capture Flow")"
echo "$CONTEXT_OUTPUT" | grep -q "PMEM_CONTEXT_READY: Implement Agent UX Capture Flow"

# Check session.json exists and has the task
test -f .pmem/session.json
grep -q "Implement Agent UX Capture Flow" .pmem/session.json

# 3. Modify source file
cat > src/index.ts <<'SRC'
export const value = 2;
SRC

# 4. Run capture --auto without manual summary (inherits task)
CAPTURE_OUTPUT="$("${PMEM[@]}" capture --auto)"
echo "$CAPTURE_OUTPUT" | grep -q "Memory sync and update completed successfully"

# Check trace file created under traces
test -d .pmem/traces
TRACE_FILE=$(ls .pmem/traces/*.md)
test -f "$TRACE_FILE"

# Filename must be strictly date-based and not summary-based
TRACE_FILENAME=$(basename "$TRACE_FILE")
echo "$TRACE_FILENAME" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}\.md$'

# Verify inherited task is inside trace card
grep -q "Capture: Implement Agent UX Capture Flow" "$TRACE_FILE"
grep -q "diff_hash:" "$TRACE_FILE"

# Verify next.md updated inside managed block
grep -q "<!-- pmem:next:start -->" .pmem/next.md
grep -q "Recommended next step: Continue development" .pmem/next.md
grep -q "<!-- pmem:next:end -->" .pmem/next.md

# 5. Run capture --auto again (duplicate check should trigger skip)
DUP_CAPTURE_OUTPUT="$("${PMEM[@]}" capture --auto)"
echo "$DUP_CAPTURE_OUTPUT" | grep -q "No new capture created. Existing trace already records this diff"

# 6. Run install --agent-rules
"${PMEM[@]}" install --agent-rules --cursor --cline --gemini --claude --codex --aider --windsurf --all >/dev/null

# Verify generated rules files are present and contain standard guidelines
test -f AGENTS.md
test -f CLAUDE.md
test -f GEMINI.md
test -f .codex/instructions.md
test -f .cursor/rules/pmem.mdc
test -f .clinerules/pmem.md
test -f CONVENTIONS.md
test -f .windsurfrules

grep -q "pmem context" AGENTS.md
grep -q "pmem capture" CLAUDE.md
grep -q "pmem context" GEMINI.md
grep -q "alwaysApply" .cursor/rules/pmem.mdc

echo "✓ E2E v0.7.4 Agent UX Release workflow passed successfully!"
