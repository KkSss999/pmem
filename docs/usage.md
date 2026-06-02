# pmem Usage Guide

A step-by-step guide to using pmem with AI coding agents. Uses Claude Code as the primary example; the same patterns work for Codex, Cursor, and other agent frameworks.

## Prerequisites

- Node.js >= 18
- A Git repository (pmem uses `git status --porcelain` for change detection; non-Git projects fall back to mtime scanning)

## 1. Install

```bash
npm install -g pmem-ai
pmem --version   # should print 0.5.0
```

The binary is `pmem`. The package name `pmem-ai` is only for npm.

## 2. One-Time Setup (per project)

Run these once in your project root:

```bash
cd your-project
pmem init your-project
pmem rebuild
```

This creates a `.pmem/` directory with:

```
.pmem/
  manifest.yml         # project configuration
  index.md             # project overview (edit this)
  state.md             # current state (edit this)
  next.md              # recommended next step (edit this)
  modules/             # module memory cards
  decisions/           # decision records
  tasks/               # task tracking
  traces/              # work traces
  integrations/        # agent framework templates
  pmem.db              # SQLite runtime index (auto-generated)
```

`pmem init --guided` lets you answer 3 questions interactively to populate the project info.

By default, `pmem init` uses the `software` preset. You can initialize with a different domain preset using the `--domain` flag:

```bash
pmem init your-novel --domain novel
```
Available presets: `software` (default), `novel`, and `research`. Specifying a preset initializes folders corresponding to the domain and registers preset schemas inside the manifest.

## 3. Create Your First Memory Card

A memory card is a Markdown file with YAML frontmatter. The most important type is `module` — it connects source files to memory:

```bash
mkdir -p .pmem/modules

cat > .pmem/modules/core.md <<'EOF'
---
id: module.core
type: module
status: active
tags: [core]
aliases: [main, entry]
source_files: [src/index.ts]
depends_on: []
---
# Core Module

## Purpose
Main application entry point.

## Key Behavior
- Initializes the app
- Loads configuration
- Boots subsystems
EOF
```

Then rebuild the index:

```bash
pmem rebuild
```

Now pmem knows that `src/index.ts` belongs to the `module.core` card.

## 4. Claude Code Integration

### 4a. Install the Integration Template

`pmem init` already created `.pmem/integrations/claude-code/CLAUDE.md`. Copy it to your project root so Claude Code can see it:

```bash
cp .pmem/integrations/claude-code/CLAUDE.md ./CLAUDE.md
```

If your project already has a `CLAUDE.md`, merge the pmem workflow section into it instead.

### 4b. What the Integration Does

The integration template teaches Claude Code the pmem workflow. Here is what happens in a typical session:

**Session Start**

Claude Code runs these when beginning work:

```bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
```

`pmem recall` outputs the project context: name, stage, current focus, state summary, recommended next step, and a list of files to read. All within the token budget.

**Before Focused Work**

```bash
pmem ask "<task or module>" --format compact
```

`pmem ask` finds relevant memory cards by exact ID match, alias, tag, graph neighbor expansion, and keyword fallback (FTS5 or LIKE).

**After Editing Code**

```bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
```

- `pmem status` detects changed files and maps them to affected memory cards
- `pmem mark-dirty --auto` marks those cards as potentially stale
- `pmem update --suggest` generates memory update suggestions

Important: As of v0.6.2, `pmem update --suggest` exits 0 regardless. Check JSON output `summary.has_actionable` to decide next steps.

**Session End**

```bash
pmem update --confirm -s "<what changed>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
```

- `pmem update --confirm` writes the confirmed changes
- `pmem session end` closes the session with a summary
- `pmem verify` checks consistency

### 4c. Complete Session Example

Here is a complete Claude Code session transcript showing pmem integration:

```bash
# === Session start ===
$ pmem session start -a "Claude"
Session started: session_2026-05-20T09-00-00

$ pmem recall --format compact --budget 2000
PROJECT: pmem
STAGE: v0.5 Productization Beta

FOCUS: Making the CLI product installable and reliable as a Beta.

NEXT:
Complete the Error UX pass for common failure scenarios.

STATE:
  - README and quick start: done
  - npm package readiness: done
  - E2E scripts: done
  - Agent docs sync: done
  - Error UX pass: in progress

READ_IF_NEEDED:
  .pmem/state.md
  .pmem/next.md
  .pmem/modules/core.md

# === Before editing src/commands/verify.ts ===
$ pmem ask "verify" --format compact
Query: verify

Matched:
  - module.verify by keyword_fallback: "verify.ts"

# === After editing the file ===
$ pmem status --format json
{
  "source": "git",
  "changes": [
    {
      "path": "src/commands/verify.ts",
      "status": "M",
      "related_cards": [{"card_id": "module.verify", "match_type": "exact"}]
    }
  ]
}

$ pmem mark-dirty --auto
Auto-marked 1 card(s) as dirty.

$ pmem update --suggest --format json
# exit code 0 (v0.6.2+), check summary.has_actionable in JSON
{
  "suggestions": [
    {
      "card_id": "module.verify",
      "action": "update",
      "reason": "Source file changed: src/commands/verify.ts"
    }
  ]
}

# === Confirm the update ===
$ pmem update --confirm -s "Added corrupt DB error handling to verify" -n "Test the error UX changes"
Memory updated.

# === Session end ===
$ pmem session end -s "Completed Error UX pass for verify command"
Session ended. 1 update recorded.

$ pmem verify
✓ Memory verification passed.
  Score: 100/100
```

## 5. What the Agent Sees

When Claude Code (or another agent) starts a session with pmem, it gets the critical project context immediately:

- **recall** gives it orientation: project name, stage, focus, state, and next steps
- **ask** finds the specific cards relevant to the current task
- **status** tells it which memory cards are affected by code changes
- **update --suggest** tells it what needs updating in the memory

The agent never needs to read the entire `.pmem/` tree. It only reads what pmem tells it to.

## 6. Adding More Memory Cards

### Decision Record

```bash
cat > .pmem/decisions/sqlite-runtime.md <<'EOF'
---
id: decision.sqlite_runtime
type: decision
status: accepted
tags: [architecture, data]
---
# Use SQLite as Runtime Index

## Context
v0.3 needed faster recall and richer query support.

## Decision
Use better-sqlite3 with WAL mode as the primary runtime store.

## Consequences
- Markdown cards remain source of truth
- SQLite is fully rebuildable from cards
- FTS5 enables keyword search; LIKE fallback for builds without FTS5
EOF

pmem rebuild
```

### Task Card

```bash
cat > .pmem/tasks/error-ux-pass.md <<'EOF'
---
id: task.error_ux_pass
type: task
status: in_progress
priority: high
tags: [v0.5, ux]
depends_on: [module.verify, module.ask]
---
# Error UX Pass

## Goal
Every common failure scenario should produce a message that says what happened, why, and what to do next.

## Sub-tasks
- [x] Corrupt DB: catch SQLITE_NOTADB in openDatabase
- [x] Missing .pmem: prompt pmem init
- [ ] Non-git status: show mtime source in compact output
EOF

pmem rebuild
```

## 7. Working with Codex

For Codex, the integration template is at `.pmem/integrations/codex/AGENTS.md`. Copy or merge it into your project's `AGENTS.md`:

```bash
cat .pmem/integrations/codex/AGENTS.md >> AGENTS.md
```

The workflow is identical — replace `Claude` with `Codex` in `pmem session start -a`.

## 8. Working with Cursor

Cursor uses `.cursor/rules/` for instructions. The pmem integration is at `.pmem/integrations/cursor/rules.example.md`:

```bash
mkdir -p .cursor/rules
cp .pmem/integrations/cursor/rules.example.md .cursor/rules/pmem.md
```

In Cursor's AI chat, prefix pmem commands with backticks:

```
`pmem session start -a "Cursor" && pmem recall --format compact --budget 2000`
```

## 9. Exit Codes

As of v0.6.2: `0` = ran successfully, `2` = runtime error. Exit code `1` is no longer used.

| Command | 0 | 2 |
|---------|---|---|
| `pmem status` | ok (changes or not) | runtime error |
| `pmem update --suggest` | ok (suggestions or not) | runtime error |
| `pmem distill --suggest` | ok (suggestions or not) | runtime error |
| `pmem verify` | ok (passed or warnings) | errors found |

> **Breaking change from v0.6.1:** Commands that previously used exit code `1` as a "workflow signal" now exit `0`. Agents should parse `--format json` output to decide next steps.

## 10. Tips for Agent Framework Authors

If you are an agent framework developer integrating pmem:

1. **Run session start + recall at session begin.** This gives the agent immediate project orientation.
2. **Run status after file writes.** Detect changes before the agent forgets what it edited.
3. **Use `--format json` for machine consumption.** Check structured output fields (e.g. `summary.has_actionable`) instead of exit codes.
4. **Don't edit `pmem.db` directly.** All writes go through Markdown cards or pmem CLI commands.
5. **Run verify at session end.** Catch stale indexes, orphan edges, or dirty flags before they accumulate.

## 11. Troubleshooting First-Run Issues

### `pmem: command not found`

npm global bin directory is not in your `PATH`. Add it:

```bash
npm config get prefix   # shows where global packages are installed
export PATH="$(npm config get prefix)/bin:$PATH"
```

### `No .pmem directory found`

You are not in a project that has been initialized. Run `pmem init <name>` from the project root.

### `pmem rebuild` says no manifest

The project was not properly initialized. Run `pmem init <name>` again.

### `pmem recall` shows empty project

No memory cards exist yet. Create at least one module card (see Section 3), then run `pmem rebuild`.

### `pmem.db` is corrupted

This can happen if the SQLite file was interrupted during a write:

```bash
mv .pmem/pmem.db .pmem/pmem.db.bak
pmem rebuild --full
```

## 12. Universal Preset Domains and Custom Schemas

Starting with v0.7.0, `pmem` is domain-neutral, supporting custom card types, custom directories, and domain-specific behaviors.

### Domain Presets
You can set a preset when initializing:
- `pmem init --domain software` (default): Configures `modules/`, `features/`, `decisions/`, `tasks/`, `risks/`, `traces/`.
- `pmem init --domain novel`: Configures `characters/`, `chapters/`, `world/`, `arc/`, `decisions/`, `traces/`. Automatically disables autodiscovery to prevent scanning noise in creative directories.
- `pmem init --domain research`: Configures `sources/`, `claims/`, `notes/`, `experiments/`, `decisions/`, `traces/`. Automatically disables autodiscovery.

### Customizing Schema & Discovery in `manifest.yml`
You can customize card validation and structure directly in your `.pmem/manifest.yml` file under the `schema` key:
- `schema.card_types`: List of all valid card types allowed in the project.
- `schema.type_dirs`: Map of card types to directory paths (e.g., `chapter: chapters`).
- `schema.creatable_types`: Types that `pmem new` can instantiate.
- `schema.foundational_types`: Core types returned as foundational cards during recall.
- `schema.evidence_types`: Card types representing evidence (used for `pmem ask` and graph tracing).
- `schema.default_type`: Fallback type when none is specified.

To toggle relationship autodiscovery, configure `discover.enabled`:
```yaml
discover:
  enabled: false
```

### Recall Output (`active_foundation`)
In `pmem recall --format json`, the field `active_foundation` returns foundational cards based on `schema.foundational_types`. For legacy compatibility, the `active_modules` field is also populated with the same list of cards.

### Zero-Migration Compatibility
v0.6.x legacy projects do not need any migration or changes. If a project does not contain a `schema` block in its manifest, `pmem` will automatically fallback to the legacy `software` defaults without modifying or rewriting the manifest file.

## Next Steps

- Read the [README](../README.md) for the full CLI reference
- Read the [v0.5 pre-design](v0.5%20pre-design.md) for the product vision
- Check `.pmem/integrations/` for your agent framework's template
