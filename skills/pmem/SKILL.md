---
name: pmem
description: Universal project memory for AI agents — initialize software, novel, or research memory; recall context; ask questions; detect changes; update cards; verify consistency across sessions.
allowed-tools: Bash(pmem:*)
---

# Project Memory with pmem

`pmem` gives agents persistent project memory across sessions. It stores memory as Markdown cards under `.pmem/` and builds SQLite indexes for fast recall. v0.7.0 is domain-neutral: the same workflow works for software projects, novels, research work, and custom card schemas.

## Quick start

```bash
# First time in a project
pmem init my-project --guided --description "A backend service" --stage "Alpha" --next "Set up CI/CD"
pmem rebuild

# Or initialize a domain preset
pmem init my-novel --domain novel
pmem init lit-review --domain research

# Restore context (do this at session start)
pmem session start -a "<agent-name>"
pmem recall --format compact --budget 2000

# Find relevant memory
pmem ask "auth module" --format compact
pmem ask "main character motivation" --format compact
pmem ask "source claim evidence" --format compact
```

## Core Workflow

Every session follows this loop:

```
session start → recall (restore context) → ask (find specific memory)
    ↓
edit project files
    ↓
pmem sync -s "<msg>" -n "<next>"  (one-step shortcut)
  - Or manual: status → mark-dirty --auto → update --suggest → update --confirm
    ↓
session end → verify (check consistency, use --fix-stale / --fix if needed)
```

## Commands

### Init & Setup

```bash
# Default software preset
pmem init my-project

# Interactive guided setup (asks 3 questions)
pmem init my-project --guided

# Domain presets (v0.7.0)
pmem init my-project --domain software
pmem init my-novel --domain novel
pmem init my-research --domain research

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

### Domain Presets & Custom Schemas (v0.7.0)

Use presets when the project is not a conventional software codebase:

| Preset | Foundational cards | Default discover |
|--------|--------------------|------------------|
| `software` | `module` | enabled |
| `novel` | `character`, `chapter` | disabled |
| `research` | `source`, `claim` | disabled |

The project manifest can define:

```yaml
schema:
  card_types: [character, chapter, world, arc, decision, trace]
  type_dirs:
    character: characters
    chapter: chapters
  foundational_types: [character, chapter]
  evidence_types: [decision, trace]
  creatable_types: [character, chapter, world, arc, decision, trace]
  default_type: trace
discover:
  enabled: false
```

For `pmem recall --format json`, read `active_foundation`. `active_modules` remains as a backward-compatible alias with the same contents.

Legacy v0.6.x projects do not need migration. When `schema` is absent, pmem falls back to the old software defaults without rewriting the manifest.

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
# Auto-discover software project relationships across 6 languages
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

For `novel` and `research` presets, `discover.enabled` defaults to `false`. Running `pmem discover` exits 0 with a disabled message and does not scan files.

### Cross-Reference with [[card-id]] Wikilinks (v0.7.0-a)

**This is the primary relationship-authoring mechanism for non-software domains** (novel, research, custom schemas) where `pmem discover` is disabled. It also adds value for software projects.

**In card body markdown**, wrap any existing card ID in double brackets to create a cross-reference:

```markdown
## Opening Scene

The story begins with [[character.protagonist]] arriving at [[world.eastern_kingdom]].

She encounters [[character.mentor]], who reveals [[arc.main_quest]].
```

On every `pmem rebuild`, pmem scans all card bodies for `[[card-id]]` patterns, resolves them against the cards table, and inserts edges with `source='mention'`, `type='references'`, `confidence=1.0`. These edges appear in `pmem related`, `pmem trace`, and `pmem ask` graph expansion, just like frontmatter-declared edges.

Key behaviors:
- **Case-sensitive**: matches the actual card ID (pmem IDs are lowercase per `id_pattern`)
- **Self-reference filtered**: `[[my-own-id]]` inside a card's own body is ignored
- **Valid targets only**: only creates edges for IDs that actually exist in the cards table — typos are silently skipped
- **Idempotent**: running rebuild twice produces identical edges
- **Works across all domains**: software, novel, research, and custom schemas

```bash
# Check mention edges for a card
pmem related character.protagonist --source mention --format json

# All edges (explicit + inferred + mention)
pmem related character.protagonist --format json
```

### Per-Card-Type Relation Thresholds (v0.7.0-a)

`warn_when_related_count_gt` (default 12) can be overridden per card type in `.pmem/manifest.yml`:

```yaml
card_policy:
  warn_when_related_count_gt: 12
  warn_when_related_count_gt_by_type:
    character: 25
    chapter: 30
    world: 15
```

Agents should customize these thresholds based on the project domain. Novel characters and chapters naturally have more cross-references than software modules.

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
# NOTE: v0.6.2+ exits 0 regardless; check JSON summary.has_actionable or summary.blocking

# Confirm and write changes
pmem update --confirm -s "Updated auth module" -n "Add token refresh"

# OR use the shortcut to sync changes in a single command (v0.7.1)
pmem sync -s "Updated auth module" -n "Add token refresh"
```

### Maintenance

```bash
# Check consistency
pmem verify
pmem verify --fix         # auto-fix stale indexes and missing DB
pmem verify --fix-stale   # auto-fix stale mtime warnings by updating card verified timestamps
pmem verify --relaxed     # temporarily double token limits for verification

# Create a new card template
pmem new decision "Choice of library"

# Batch replace text in card bodies
pmem rename --find "old-lib" --replace "new-lib" --write

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
pmem session start -a "<agent-name>"
pmem session end -s "Completed auth refactor"
```

### Integrations

```bash
# Install Claude Code integration (CLAUDE.md + slash commands)
pmem integration install claude-code

# Install agent skills globally
pmem install --skills --claude     # → ~/.claude/skills/pmem/
pmem install --skills --codex      # → ~/.codex/skills/pmem/
pmem install --skills --gemini     # → ~/.gemini/skills/pmem/
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
* **Universal domains and schemas** — [references/universal-domains.md](references/universal-domains.md)
* **Discovering project relationships** — run `pmem discover --dry-run --format json` to see inferred edges, then use `pmem update --confirm --accept-edges` to promote them
* **Troubleshooting** — [references/troubleshooting.md](references/troubleshooting.md)
