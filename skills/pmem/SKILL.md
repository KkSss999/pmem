---
name: pmem
description: Universal project memory for AI agents — initialize software, novel, or research memory; recall context; ask questions; detect changes; update cards; verify consistency across sessions.
allowed-tools: Bash(pmem:*)
---

# Project Memory with pmem

`pmem` gives agents persistent project memory across sessions. It stores memory as Markdown cards under `.pmem/` and builds SQLite indexes for fast recall. **v1.2** adds optional local semantic recall, contextual reranking, and multidimensional memory health while keeping deterministic retrieval authoritative. Domain-neutral since v0.7.0: the same workflow works for software projects, novels, research work, and custom card schemas.

## Quick start

```bash
# Install the complete model-free base CLI
npm install -g pmem-ai@1.2.4

# First time in a project: init also builds the first local index
pmem init my-project

# Start task: restore and aggregate context
pmem context "implement login throttling"

# Modify files...

# End task: record the known result and next step
pmem sync -s "implemented login throttling" -n "add integration tests"
pmem verify
```

The base `pmem-ai` package is the default and complete product experience. It
does not install or download Transformers, ONNX Runtime, `sharp`, or a semantic
model. Do not instruct users to install `pmem-ai-semantic` unless they explicitly
want local semantic recall.

## Core Workflow

Every session follows this simplified loop:

```
  pmem context "<task>"  (start of session / restore task context)
          ↓
  edit project files
          ↓
  pmem sync -s "..." -n "..."  (record result, next step, and rebuild)
```

Use `pmem capture --auto` instead when pmem should derive the trace from the
working tree. Use the lower-level `status → mark-dirty → update` sequence for
review-heavy maintenance.

## Installation Modes

| Mode | Install | User outcome |
|---|---|---|
| Base, recommended | `npm install -g pmem-ai@1.2.4` | Deterministic Markdown, SQLite/FTS, graph recall, health, MCP, and SDK |
| Semantic enhancement, macOS and Windows | Base package plus `npm install -g pmem-ai-semantic@1.2.4` | Adds local multilingual embeddings and contextual reranking |

`pmem-ai-semantic` is an optional runtime companion, not another CLI. If the
companion, shared model, or semantic index is unavailable, `ask`, `context`, and
`recall` must remain usable through deterministic retrieval.

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

# Fresh projects are indexed by init and immediately ready for recall/ask/context.
# Use rebuild after later Markdown edits or to recover a missing index.

# Rebuild SQLite indexes from cards
pmem rebuild
pmem rebuild --full          # full rebuild, clear all tables
pmem rebuild --card module.core  # rebuild single card
```

### Optional Semantic Retrieval (macOS and Windows)

```bash
npm install -g pmem-ai-semantic@1.2.4
pmem semantic enable
pmem semantic status
```

`semantic enable` explicitly prepares or reuses the one verified global model
cache under `~/.pmem-global/models` and builds the current project's derived
vectors in `.pmem/pmem.db`. Models are never copied per project. The default
install and `pmem init` never download a model. Operators may use
`pmem semantic setup` and `pmem semantic rebuild` separately.

When guiding a user:

1. Start with the base CLI and confirm `pmem init`, `context`, and `ask` work.
2. Offer semantic enhancement only as an explicit optional step.
3. Run `pmem semantic enable`; it handles confirmation, cache reuse/download,
   manifest enablement, and the current-project full semantic rebuild.
4. Use `pmem semantic status` for readiness and `pmem semantic clear` to disable
   the project index without deleting the global model.

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

### Context Recovery (v0.8 Hybrid Recall)

```bash
# Restore project context (hot memory, ~2000 tokens)
pmem recall --format compact --budget 2000
pmem recall --mode brief --budget 500    # L0 + READ_IF_NEEDED only

# Search for specific topics
pmem ask "sqlite runtime" --format compact
pmem ask "src/core/query/recall.ts" --explain --limit 5
pmem ask "module.core" --format json    # machine-readable

# Explore graph neighbors
pmem related module.core --depth 2
pmem trace decision.sqlite_runtime
```

v0.8 adds recall modes to `pmem recall` and replaces `pmem ask` with the Hybrid Recall Engine: a 5-stage deterministic pipeline (intent parse → multi-channel candidate generation → graph expansion → score fusion → L0-L3 budget packing) that fuses exact IDs, aliases, tags, source file paths, FTS5/BM25, graph expansion, recency, and stale/dirty penalties into a ranked result. Use `--explain` to see per-card `reasons[]` and `factors{}`. The recall output is structured into:
- **PROJECT & STAGE**: The current metadata of the repository.
- **CURRENT CONTEXT**: Recent summaries of what the project is doing.
- **RECENT CHANGES**: Thick trace logs of what files and symbols changed.
- **ARCHITECTURE**: Map of active modules and their files.
- **DECISIONS**: Case-insensitive deduplicated long-term decisions.
- **NEXT**: Recommended next steps.

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
pmem mark-dirty --card module.core --card decision.jwt -r "Manual frontmatter edit"

# Get memory update suggestions
pmem update --suggest --format json
# NOTE: v0.6.2+ exits 0 regardless; check JSON summary.has_actionable or summary.blocking

# Confirm and write changes
pmem update --confirm -s "Updated auth module" -n "Add token refresh"

# Refresh last_verified on specific cards without creating separate traces
pmem update --confirm -s "Reviewed changes" --refresh-verified module.core,decision.jwt

# OR use the shortcut to sync changes in a single command (v0.7.1)
pmem sync -s "Updated auth module" -n "Add token refresh"
```

### Maintenance

```bash
# Check consistency
pmem verify
pmem verify --fix         # repair structural issues (stale index, missing DB, orphan edges)
pmem verify --fix-stale   # --fix + refresh stale_memory last_verified timestamps (one-shot cleanup)
pmem verify --relaxed     # temporarily double token limits for verification
pmem health migrate       # dry-run missing classification/trust/sensitivity metadata
pmem health migrate --apply --trust-label <label> --sensitivity <level>  # apply explicit choices

# Record a release milestone
pmem milestone v0.8.0 -m "Graph visualization closeout"
pmem milestone v1.0.0 --tag v1.0.0-rc1

# Create a new card template
pmem new decision "Choice of library"

# `pmem new` gives structured cards explicit `user_confirmed` trust and
# `internal` sensitivity; trace cards remain `agent_generated` and are not
# implicitly admitted to semantic retrieval.

# Batch replace text in card bodies
pmem rename --find "old-lib" --replace "new-lib" --write

# Consolidate traces into stable cards
pmem distill --suggest
pmem distill --confirm

# Propose and write module cards based on codebase directories & rules (v0.7.5)
pmem module infer         # dry-run
pmem module infer --write # writes module.xxx.md candidate cards

# Scan trace history for decision statements to promote (v0.7.5)
pmem decision infer       # dry-run
pmem decision infer --write # writes decision.xxx.md candidate cards

# Run diagnostics
pmem doctor
pmem doctor --format json

# Safely forget a memory card (durable tombstone, audit-preserving)
pmem forget module.old --confirm --reason "No longer relevant"
pmem forget trace.2026-07-22-001 --confirm -r "Cleanup test trace"

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

### MCP Server (v1.0)

Start a stdio MCP server. Default is read-only; use `--write=append-only` for write tools:

```bash
pmem mcp                          # read-only
pmem mcp --write=append-only      # allows capture, observe, forget
```

**Agent configuration example** (Claude Code `mcpServers`):

```json
{
  "mcpServers": {
    "pmem-rt": {
      "command": "pmem",
      "args": ["mcp", "--write=append-only"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Read-only tools** (always available):

| Tool | Description |
|------|-------------|
| `pmem_recall` | Restore project memory context (stage, focus, next, active cards, updates) |
| `pmem_ask` | Search memory with Hybrid Recall Engine (exact ID → alias → tag → source-file → FTS5/BM25 → graph expansion → score fusion) |
| `pmem_related` | Query graph neighbors of a card (edges grouped by type with direction/confidence) |
| `pmem_status` | Detect changed files and affected memory cards (git or mtime) |
| `pmem_context` | Retrieve budget-aware, task-specific context package |

**Append-only write tools** (require `--write=append-only`):

| Tool | Description |
|------|-------------|
| `pmem_capture` | Capture memory updates, write trace card, update next.md managed blocks |
| `pmem_observe` | Append a structured observation to Runtime working memory (event store only) |
| `pmem_forget` | Append a tombstone event for an observation or memory identifier (audit-preserving) |

All card content carries `content_trust: "untrusted_project_data"`. See [docs/pmem-rt.md](../docs/pmem-rt.md) for the full integration guide.

### System Memory Security (v1.1)

**Namespace Hierarchy** — 9-level scope system: `system` → `user` → `application` → `workspace` → `agent` → `task` → `session`, plus `private` and `shared`. Use `ScopeManager` to resolve principals and inherit capabilities.

**Capability ACL (12 capabilities)** — `read`, `search`, `observe`, `propose`, `commit`, `amend`, `supersede`, `forget`, `purge`, `share`, `export`, `admin`. Capabilities are granted per-principal with scope inheritance (`agent:x` → `agent:x:*`). When no capabilities are registered, behavior matches v1.0 (read/search open).

**Agent Quotas** — `PolicyEngine.setQuota()` enforces per-principal observe/capture limits. Capability checks run before quota so denied operations don't consume quota.

**Memory Poisoning Defense** — `pmem verify` now detects untrusted-ratio warnings (>20% untrusted), `untrusted_fact` conflicts, and `agent_only_decision` info alongside trust-label checks.

**Trust-Aware Recall** — `sensitivity`, `trust_label`, `classification`, `confidence`, and `superseded_by` columns are persisted to SQLite and surfaced in `recall`/`ask`. `confidence` boosts/penalizes and `superseded_by` down-weights results in scoring.

**Secret Sensitivity Filtering** — `secret` sensitivity cards are excluded at the query source (`recall`/`ask`/`context`) and in output formatting. This filtering covers all read paths: recall foundational lists, the relation graph (`related`/`pmem_related`), and the `pmem trace`/`graph` CLI. A secret main card reports not-found and secret relation targets are omitted.

### Runtime / SDK (v1.0)

For deep integration, use the embeddable `Pmem` Runtime:

```ts
import { Pmem } from 'pmem-ai';

const memory = await Pmem.open({ root: '/path/to/project' });
const ctx = await memory.context('implement auth', 2000);
await memory.observe({ file: 'src/auth.ts', summary: 'Added JWT middleware' });
const receipt = await memory.forget({ id: 'trace.old', reason: 'Stale' });
await memory.close();
```

SDK methods: `ask()`, `recall()`, `context()`, `related()`, `status()`, `observe()`, `forget()`, `capture()`, `endSession()`, `close()`.

CLI, MCP, and SDK all call the same Runtime core — one implementation, three interfaces.

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
