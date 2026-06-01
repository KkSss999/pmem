#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PMEM=(node "$ROOT/dist/index.js")

cd "$ROOT"
npm run build >/dev/null

# Test install --skills --claude
"${PMEM[@]}" install --skills --claude >/dev/null

# Verify skill files were installed
test -f ~/.claude/skills/pmem/SKILL.md || { echo "FAIL: ~/.claude/skills/pmem/SKILL.md not found"; exit 1; }
test -f ~/.claude/skills/pmem/references/session-workflow.md || { echo "FAIL: session-workflow.md not found"; exit 1; }
test -f ~/.claude/skills/pmem/references/first-init.md || { echo "FAIL: first-init.md not found"; exit 1; }
test -f ~/.claude/skills/pmem/references/memory-cards.md || { echo "FAIL: memory-cards.md not found"; exit 1; }
test -f ~/.claude/skills/pmem/references/troubleshooting.md || { echo "FAIL: troubleshooting.md not found"; exit 1; }

# Verify SKILL.md has correct frontmatter
grep -q "name: pmem" ~/.claude/skills/pmem/SKILL.md || { echo "FAIL: SKILL.md missing name"; exit 1; }
grep -q "allowed-tools: Bash(pmem:\*)" ~/.claude/skills/pmem/SKILL.md || { echo "FAIL: SKILL.md missing allowed-tools"; exit 1; }

# Test install --skills --codex (directory may not exist yet; install creates it)
"${PMEM[@]}" install --skills --codex >/dev/null
test -f ~/.codex/skills/pmem/SKILL.md || { echo "FAIL: ~/.codex/skills/pmem/SKILL.md not found"; exit 1; }

# Test install --skills --gemini
"${PMEM[@]}" install --skills --gemini >/dev/null
test -f ~/.gemini/skills/pmem/SKILL.md || { echo "FAIL: ~/.gemini/skills/pmem/SKILL.md not found"; exit 1; }

echo "skills install passed"
