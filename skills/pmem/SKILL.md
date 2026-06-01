---
name: pmem
description: Project memory for AI agents — recall context, ask questions, detect changes, update memory, verify consistency across sessions.
allowed-tools: Bash(pmem:*)
---

# Project Memory with pmem

`pmem` gives coding agents persistent project memory across sessions. It stores memory as Markdown cards under `.pmem/` and builds SQLite indexes for fast recall.

## Quick start

```bash
# First time in a project
pmem init my-project --guided --description "A backend service" --stage "Alpha" --next "Set up CI/CD"
pmem rebuild

# Restore context (do this at session start)
pmem session start -a "Claude"
pmem recall --format compact --budget 2000

# Find relevant memory
pmem ask "auth module" --format compact
```

## Core Workflow

Every session follows this loop:

```
session start → recall (restore context) → ask (find specific memory)
    ↓
edit code
    ↓
status (detect changes) → mark-dirty --auto (flag affected cards)
    ↓
update --suggest (get recommendations) → update --confirm (write memory)
    ↓
session end → verify (check consistency)
```

## Commands

### Init & Setup

```bash
# Interactive guided setup (asks 3 questions)
pmem init my-project --guided

# Non-interactive (for scripts and agents)
pmem init my-project --guided \
  --description "Project description" \
  --stage "Current stage" \
  --next "Next step"

# From JSON file
pmem init my-project --answers ./pmem-init.json

# Rebuild SQLite indexes from cards
pmem rebuild
pmem rebuild --full          # full rebuild, clear all tables
pmem rebuild --card module.core  # rebuild single card
```

### Context Recovery

```bash
# Restore project context (hot memory, ~2000 tokens)
pmem recall --format compact --budget 2000

# Search for specific topics
pmem ask "sqlite runtime" --format compact
pmem ask "module.core" --format json    # machine-readable

# Explore graph neighbors
pmem related module.core --depth 2
pmem trace decision.sqlite_runtime
```

### Relationship Discovery (v0.6.3+)

```bash
# Auto-discover project relationships across 6 languages
pmem discover --dry-run --format json     # preview without writing
pmem discover --format json               # discover and write inferred edges

# Filter by language
pmem discover --lang nodejs,python

# Use custom pattern file
pmem discover --pattern-file .pmem/discover-patterns.json

# Review and manage inferred edges
pmem related <id> --format json --source inferred
pmem update --confirm --accept-edges 1,2,3
pmem update --confirm --reject-edges 4,5
```

The discover command scans:
- **Source file imports** (6 languages: Node.js, Python, Rust, Go, C/C++, Java) - confidence 0.7
- **Package manager dependencies** (package.json, Cargo.toml, go.mod, etc.) - confidence 0.7-0.85

**False-positive guard**: language builtins (Node.js `fs`/`path`/`crypto`, Python `os`/`sys`/`json`, Go `fmt`/`net`, Java `java.*`/`javax.*`/`jakarta.*`/Spring, C/C++ standard headers) and `@types/*` are silently dropped before any output. They never become edges or ambiguous entries.

**Ambiguous output is signal-first**: each `ambiguous` entry has a `severity` of either:
- `actionable` — local project file that has no card. Run `pmem new module "Title"` to create one, or `pmem update --confirm --reject-edges <id>` if no card is needed.
- `informational` — external package / framework / builtin with no card. No action needed.

The compact output lists actionable items first, then collapses informational ones to a count. Parse `summary.actionable` from JSON to drive your review loop.

### Change Detection & Memory Update

```bash
# Detect changed files and affected cards
pmem status --format json
pmem status --format compact   # human-readable, shows [git] or [mtime]

# Mark affected cards as potentially stale
pmem mark-dirty --auto
pmem mark-dirty -r "Refactored auth module"

# Get memory update suggestions
pmem update --suggest --format json
# NOTE: v0.6.2+ exits 0 regardless; check JSON summary.has_actionable for suggestions

# Confirm and write changes
pmem update --confirm -s "Updated auth module" -n "Add token refresh"
```

### Maintenance

```bash
# Check consistency
pmem verify
pmem verify --fix       # auto-fix stale indexes and missing DB

# Consolidate traces into stable cards
pmem distill --suggest
pmem distill --confirm

# Run diagnostics
pmem doctor
pmem doctor --format json

# Migrate schema
pmem migrate --to 0.3 --dry-run
pmem migrate --to 0.3 --backup
```

### Sessions

```bash
pmem session start -a "Claude"
pmem session end -s "Completed auth refactor"
```

### Integrations

```bash
# Install Claude Code integration (CLAUDE.md + slash commands)
pmem integration install claude-code

# Install agent skills globally
pmem install --skills --claude     # → ~/.claude/skills/pmem/
pmem install --skills --codex      # → ~/.codex/skills/pmem/
pmem install --skills --all        # → all detected agents

# Verify integration status
pmem integration verify
```

## Exit Codes

v0.6.2+: `0` = ok, `2` = runtime error. Exit code `1` is no longer used as a workflow signal.

| Command | 0 | 2 |
|---------|---|---|
| `pmem status` | ok (changes or not) | runtime error |
| `pmem update --suggest` | ok (suggestions or not) | runtime error |
| `pmem distill --suggest` | ok (suggestions or not) | runtime error |
| `pmem verify` | ok (passed or warnings) | errors |
| `pmem doctor` | ok (passed or warnings) | errors |

Agents should parse `--format json` output to decide next steps.

## Session Workflow Example

```bash
# === Session start ===
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
# → PROJECT: my-app
# → STAGE: Alpha
# → FOCUS: Build auth system
# → NEXT: Add token refresh

# === Before working on auth ===
pmem ask "auth" --format compact
# → Matched:
# →   - module.auth by tag: "Auth Module"

# === Edit auth files, then ===
pmem status --format json
# → {"source":"git","changes":[{"path":"src/auth.ts",...}]}

pmem mark-dirty --auto
# → Auto-marked 1 card(s) as dirty.

pmem update --suggest --format json
# → exit code 0, check summary.has_actionable
# → {"suggestions":[{"action":"update_card","target":"module.auth",...}]}

# === Confirm the update ===
pmem update --confirm -s "Added token refresh" -n "Write tests"

# === Session end ===
pmem session end -s "Auth: added token refresh logic"
pmem verify
# → ✓ Memory verification passed. Score: 100/100
```

## Specific Tasks

* **First-time project setup** — [references/first-init.md](references/first-init.md)
* **Session workflow in detail** — [references/session-workflow.md](references/session-workflow.md)
* **Creating memory cards** — [references/memory-cards.md](references/memory-cards.md)
* **Discovering project relationships** — run `pmem discover --dry-run --format json` to see inferred edges, then use `pmem update --confirm --accept-edges` to promote them
* **Troubleshooting** — [references/troubleshooting.md](references/troubleshooting.md)
