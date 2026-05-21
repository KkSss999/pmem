#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/tmp/pmem-e2e-claude-integration"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"

# Init a project first
"${PMEM[@]}" init test-v06-claude --description "x" --stage "y" --next "z"

# Install Claude Code integration
"${PMEM[@]}" integration install claude-code

# Verify CLAUDE.md exists
test -f CLAUDE.md || { echo "FAIL: CLAUDE.md not created"; exit 1; }

# Verify slash command files exist
test -f .claude/commands/pmem-recall.md  || { echo "FAIL: .claude/commands/pmem-recall.md not found"; exit 1; }
test -f .claude/commands/pmem-ask.md     || { echo "FAIL: .claude/commands/pmem-ask.md not found"; exit 1; }
test -f .claude/commands/pmem-update.md  || { echo "FAIL: .claude/commands/pmem-update.md not found"; exit 1; }
test -f .claude/commands/pmem-distill.md || { echo "FAIL: .claude/commands/pmem-distill.md not found"; exit 1; }

# Verify integration verify reports claude-code as installed
"${PMEM[@]}" integration verify | grep -q "claude-code" || { echo "FAIL: integration verify did not report claude-code installed"; exit 1; }

# Clean up
rm -rf "$PROJECT"

echo "claude integration passed"
