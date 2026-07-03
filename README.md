# pmem

Project Memory for AI Agents.

`pmem` is a local CLI runtime that helps coding agents remember a project: where it is, what changed, what matters next, and why. It stores project memory as Markdown cards in `.pmem/`, then builds SQLite indexes so agents can recall context with fewer tokens and update memory as code changes.

## Why pmem

Coding agents lose project context quickly. A repository has source files, docs, decisions, tasks, and traces, but the agent usually has to rediscover that context every session.

`pmem` gives the project a small, explicit memory layer:

- `pmem context "<task>"` restores and aggregates task-specific memory and file context.
- `pmem capture --auto` automatically synchronizes modified files and memory status.
- `pmem install --agent-rules` installs compact rules files (AGENTS.md, Cursor rules, etc.) to guide coding agents.
- `pmem ask "<query>"` finds relevant memory cards.
- `pmem discover` auto-discovers project relationships (tech stack, file deps, imports) across 6 languages.
- `pmem verify` checks that Markdown cards and runtime indexes still agree.


The design is intentionally local and Git-friendly. Markdown cards remain the source of truth. SQLite is a rebuildable runtime index, not a separate knowledge base.

## Who It Is For

`pmem` is useful when:

- You use code agents such as Codex, Claude Code, Cursor, or similar tools.
- Your project has decisions and context that should survive across sessions.
- You want agents to update memory deliberately instead of auto-writing noisy logs.
- You prefer local files over hosted memory services.

It is not a vector database, MCP server, Graph UI, or remote multi-user service. v0.6 focuses on making the CLI agent-native with relationship discovery and polished workflows.

## Install

```bash
npm install -g pmem-ai
pmem --version
```

Node.js 18 or newer is required. `better-sqlite3` is compiled during install.

Run `pmem doctor` anytime to check the health of your project memory setup.

To install from source:

```bash
git clone https://github.com/KkSss999/pmem.git
cd pmem
npm install
npm run build
npm link
```

### Installing Agent Skills

After installing the CLI, add pmem skills to your agent so it knows how to use pmem:

```bash
pmem install --skills --claude    # → ~/.claude/skills/pmem/
pmem install --skills --codex     # → ~/.codex/skills/pmem/
pmem install --skills --gemini    # → ~/.gemini/skills/pmem/
pmem install --skills --all       # → all detected agents
```

Run the command for each agent you use. Each install copies the packaged
`skills/pmem/` directory, including `SKILL.md` and the reference guides, into
that agent's global skills folder.

Verify the installed skill files:

```bash
test -f ~/.claude/skills/pmem/SKILL.md
test -f ~/.codex/skills/pmem/SKILL.md
test -f ~/.gemini/skills/pmem/SKILL.md
```

## 5-Minute Quick Start

Create project memory in a repository:

```bash
pmem init my-project
pmem rebuild
pmem context "Implement core setup"
pmem capture --auto
```

For a richer setup:

```bash
pmem init my-project --guided
```

Add a module card that points at source files:

```bash
mkdir -p .pmem/modules src
cat > .pmem/modules/core.md <<'EOF'
---
id: module.core
type: module
status: active
tags: [core]
source_files: [src/index.ts]
---

# Core

## Purpose
Main project entry point.
EOF

echo "export const value = 1;" > src/index.ts
pmem rebuild
pmem ask "core" --format compact
```

Then make a code change and let pmem identify the affected memory:

```bash
echo "export const value = 2;" > src/index.ts
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
pmem update --confirm -s "Updated core module" -n "Continue development"
pmem verify
```

Note: `pmem update --suggest` outputs suggestions in JSON. Agents should check `summary.has_actionable` to decide next steps.

### The Second Session (Cross-Session Recall)

pmem's value appears when you come back. Open a new terminal or start a new agent session the next day:

```bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
```

Output:
```
PROJECT: my-project
STAGE: Active development
FOCUS: Updated core module
NEXT: Continue development
STATE:
  - Core module value updated to 2
READ_IF_NEEDED:
  .pmem/state.md
  .pmem/next.md
  .pmem/modules/core.md
```

In a single command you restored the project context, last state, and what to read next — without re-reading all your source files or asking "where were we?" This is pmem's core value: **cross-session project memory**.

### Agent-Native Init (for scripts and CI)

For agents and scripts that can't answer TTY prompts:

```bash
pmem init my-project --guided \
  --description "A backend service" \
  --stage "Alpha" \
  --next "Set up CI/CD"
```

Or with a JSON file:

```bash
pmem init my-project --answers ./pmem-init.json
```

## Core Concepts

### Markdown Cards

Cards under `.pmem/**/*.md` are the source of truth. Each card has YAML frontmatter and Markdown body content.

Common card types include:

- `module`
- `feature`
- `decision`
- `task`
- `risk`
- `trace`

Important frontmatter fields:

```yaml
id: module.core
type: module
status: active
tags: [core]
aliases: [runtime]
source_files: [src/index.ts]
depends_on: [decision.sqlite_runtime]
```

### SQLite Runtime

`.pmem/pmem.db` stores rebuildable indexes and runtime state:

- cards
- edges
- aliases
- tags
- paths
- sessions
- dirty flags
- update logs

Do not edit SQLite directly. Edit Markdown cards or use pmem workflow commands, then run `pmem rebuild`.

### Recall And Ask

Use `recall` for the current project state. v0.8 (upcoming on `main` branch, not yet released to npm) adds budget modes: `brief` returns L0 + read-if-needed paths, `normal` is the default agent context, and `deep` preserves more detail when budget allows.

```bash
pmem recall --budget 2000
pmem recall --mode brief --budget 500
```

Use `ask` for targeted retrieval. v0.8 (upcoming on `main` branch, not yet released to npm) uses the Hybrid Recall Engine: exact IDs, aliases, tags, source file paths, always-on FTS5/BM25, graph expansion, recency, and stale/dirty penalties are fused into a deterministic score. Add `--explain` to see why each card was recalled.

```bash
pmem ask "sqlite runtime" --format compact
pmem ask "src/core/query/recall.ts" --explain --limit 5
pmem ask "release checklist" --format json
```

### Relations

Use `relations` to inspect a card's edge graph and find pruning candidates:

```bash
pmem relations module.auth --format json
```

The JSON output includes `outgoing` / `incoming` edge lists, `summary_by_type`, `summary_by_source`, and `pruning_candidates` — edges with `source: inferred` or `confidence < 0.5` that are safe to prune. This helps agents reduce noise when a card accumulates too many low-quality relations.

### Dirty, Update, Distill

The memory update flow is intentionally confirmation-first:

```bash
pmem status
pmem mark-dirty --auto
pmem update --suggest
pmem update --confirm -s "<summary>" -n "<next step>"
pmem distill --suggest
pmem verify
```

Alternatively, you can run the one-command sync and update shortcut (v0.7.1):

```bash
pmem sync -s "<summary>" -n "<next step>"
```

`distill` consolidates trace cards into stable cards when enough evidence accumulates.

### Lock Protocol (v0.7.6)

`pmem rebuild` and `pmem update --confirm` acquire `.pmem/.lock` during index mutations. `pmem verify` acquires the lock before reading the SQLite index.

When an agent runs `pmem verify` during an active rebuild:
- It emits an `active_lock` info note (not a warning/error) and defers all index freshness checks.
- The output says `clean (index checks deferred)` with Score 100/100.
- No transient `stale_index` or `missing_database` warnings are emitted — those checks are skipped because another process holds the lock.

If a `pmem` process crashes, the lock may become stale (>60s). Run:

```bash
pmem verify --fix-locks    # clean the stale lock
```

Agent guidance:
- If `pmem verify` reports `active_lock`, wait and retry — do not treat it as a failure.
- If it reports `stale_lock`, run `pmem verify --fix-locks` before proceeding.

### Verify Output: too_many_relations

When a card exceeds its relation threshold, `pmem verify` emits `too_many_relations` with `top_edges` (up to 10 lowest-confidence edges) and `pruning_candidates` (edges with `source: inferred` or `confidence < 0.5`). Agents can use `pruning_candidates` to suggest which relations to remove, or run `pmem relations <id> --format json` for a full inspection.

### Module & Decision Inference (v0.7.5)

To automate codebase module and decision mapping:
- **`pmem module infer`**: Scans project directories and content keywords to automatically propose `module` memory card candidates.
- **`pmem decision infer`**: Analyzes the trace capture history for decision patterns/comments and suggests `decision` memory card candidates.

Use `--write` to save proposed candidates (tagged `inferred` and written as `status: active` cards) to `.pmem/modules/` and `.pmem/decisions/` respectively. Cards are clearly marked with the `inferred` tag so you can review and confirm them before relying on them as source of truth.

### Domain Presets & Custom Schema

Starting with v0.7.0, `pmem` is domain-neutral. You can initialize a project with a domain preset, customize valid card types, directories, and behavior.

#### Domain Presets

Initialize a project with a domain preset using `--domain <preset>`:
```bash
pmem init my-project --domain novel
```

Built-in presets:
- **`software`** (default): For software engineering projects. Creates directories for `modules/`, `features/`, `decisions/`, etc. `discover` is enabled. Foundational types: `['module']`.
- **`novel`**: For creative writing. Creates directories for `characters/`, `chapters/`, `world/`, `arc/`, `decisions/`, `traces/`. `discover` is disabled by default. Foundational types: `['character', 'chapter']`.
- **`research`**: For literature reviews, research papers, and studies. Creates directories for `sources/`, `claims/`, `notes/`, `experiments/`, `decisions/`, `traces/`. `discover` is disabled by default. Foundational types: `['source', 'claim']`.

#### Custom Schema Manifest Settings

The manifest `schema` section controls validation and runtime behavior:
- `schema.card_types`: Whitelist of valid card types.
- `schema.type_dirs`: Key-value map of card types to directory paths (e.g., `character: characters`).
- `schema.creatable_types`: Types that `pmem new` can instantiate.
- `schema.foundational_types`: Core types returned as foundational cards during recall.
- `schema.evidence_types`: Card types representing evidence (e.g., `decision`, `trace`) used for `pmem ask` and graph tracing.
- `schema.default_type`: Fallback type when none is specified.

#### Recall Output (`active_foundation`)

When calling `pmem recall --format json` on non-software domains, the JSON output populates `active_foundation` with cards matching the `foundational_types` configuration. For legacy compatibility, the `active_modules` field is also populated with the same list.

#### Discovery Configuration (`discover.enabled`)

To toggle autodiscovery globally, configure `discover.enabled` in `manifest.yml`:
```yaml
discover:
  enabled: false
```
When disabled, running `pmem discover` will print a disabled message and exit `0` immediately without scanning files.

#### Backward Compatibility

`pmem` v0.7.0 maintains strict zero-migration backward compatibility with v0.6.x legacy projects. If a project does not contain a `schema` block in its manifest, `pmem` will automatically fall back to the legacy `software` defaults without modifying or rewriting the manifest file.

## Agent Workflow

At the start of an agent session:

```bash
pmem session start -a "Codex"
pmem recall --format compact --budget 2000
```

Before a specific task:

```bash
pmem ask "<task or module>" --format compact
```

After editing files:

```bash
# Recommended shortcut:
pmem sync -s "<what changed>" -n "<next step>"

# Or manual update flow:
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
pmem update --confirm -s "<what changed>" -n "<next step>"
```

At session end:

```bash
pmem session end -s "<task summary>"
pmem verify
```

Installed integration templates are available under:

```txt
.pmem/integrations/
```

## CLI Reference

```bash
pmem init [project-name] [--guided] [--description <text>] [--stage <text>] [--next <text>] [--answers <path>] [--domain software|novel|research]

pmem context <task> [--budget N] [--format compact|json]
pmem capture [--auto] [-s <summary>] [-n <next>] [--full] [--force]

pmem recall [--budget N] [--mode brief|normal|deep] [--format compact|json|paths|pack] [--since <duration>]
pmem ask <query> [--format compact|json|paths|pack] [--explain] [--limit N]
pmem discover [--dry-run] [--format compact|json] [--min-confidence <n>]
              [--lang auto|nodejs,python,rust,go,cpp,java]
              [--pattern-file <path>]
pmem related <id> [--depth N] [--type <edge-type>] [--format compact|json] [--source explicit|inferred|mention|all]
pmem relations <id> [--format json]
pmem trace <id>

pmem status [--since <timestamp>] [--format compact|json]
pmem mark-dirty [-r <reason>] [--auto] [--card <id...>]
pmem update [--auto] [--suggest] [--apply-suggestion <id>] [--confirm] [--force]
            [-s <summary>] [-n <next>] [--format compact|json] [--include-history]
            [--accept-edges <ids>] [--reject-edges <ids>]
            [--refresh-verified <ids>]
pmem sync -s "<summary>" [-n "<next>"]

pmem milestone <version> [-m <message>] [--tag <name>]

pmem module infer [--write] [--dry-run]
pmem decision infer [--from-traces] [--write]

pmem distill [--suggest] [--confirm] [--apply-suggestion <id>] [--suggest-splits]
pmem rebuild [--changed] [--full] [--card <id>]
pmem verify [--fix] [--fix-stale] [--fix-locks] [--relaxed]
pmem doctor [--format compact|json]
pmem new <type> <title>
pmem rename --find <pattern> --replace <replacement> [--write]
pmem migrate [--to <version>] [--dry-run] [--backup]
pmem session start [-a <agent-name>]
pmem session end [-s <summary>]
pmem integration list|install <framework>|verify
pmem install [--skills] [--agent-rules] [--claude] [--codex] [--gemini] [--cursor] [--cline] [--aider] [--windsurf] [--all]
pmem mcp [--write readonly|append-only]
```

## Exit Codes

As of v0.6.2, exit code `0` means the command ran successfully (results or not). Exit code `2` means a runtime error occurred. Exit code `1` is no longer used as a workflow signal.

| Command | 0 | 2 |
|---------|---|---|
| `pmem status` | ok (changes or not) | runtime error |
| `pmem update --suggest` | ok (suggestions or not) | runtime error |
| `pmem distill --suggest` | ok (suggestions or not) | runtime error |
| `pmem verify` | ok (passed or warnings) | errors found |

Agents should parse structured JSON output (`--format json`) to decide next steps, rather than relying on exit codes.

> **Breaking change from v0.6.1:** `pmem update --suggest` and `pmem distill --suggest` previously exited with code `1` when suggestions existed. Scripts that checked `$? -eq 1` must now parse JSON output instead.

## pmem-rt — MCP Runtime for AI Agents

pmem-rt is a stdio MCP server that lets AI coding agents interact with pmem directly in their tool loop.

Default mode is read-only:

```bash
pmem mcp
```

Append-only capture mode:

```bash
pmem mcp --write=append-only
```

### MCP Tools

| Tool           | Mode        | Description                                   |
| -------------- | ----------- | --------------------------------------------- |
| `pmem_recall`  | readonly    | Restore project context                       |
| `pmem_ask`     | readonly    | Search memory cards                           |
| `pmem_related` | readonly    | Query graph neighbors                         |
| `pmem_status`  | readonly    | Detect changed files                          |
| `pmem_context` | readonly    | Get task-aware context package                |
| `pmem_capture` | append-only | Append trace and update managed next.md block |

All read-only tools are safe to execute and do not perform any side effects on the workspace. In `append-only` mode, the agent can call `pmem_capture` to create new traces and update `next.md` managed blocks, while direct modifications to core cards remain strictly blocked. Every card object returned carries `content_trust: "untrusted_project_data"`.

[Full integration guide →](docs/pmem-rt.md)

## Project Layout

```txt
.pmem/
  manifest.yml
  index.md
  state.md
  next.md
  modules/
  features/
  decisions/
  tasks/
  traces/
  summaries/
  risks/
  candidates/
  skills/
  integrations/
  indexes/
  pmem.db
```

Source-of-truth files are Markdown cards. `pmem.db` and `indexes/` are generated runtime data.

## Integrating with Agent Frameworks

See [docs/usage.md](docs/usage.md) for a step-by-step guide to integrating pmem with Claude Code, Codex, and Cursor.

## Troubleshooting

### No `.pmem` Directory

Run:

```bash
pmem init <project-name>
```

Run commands from the project root where `.pmem/` should live.

### `.pmem/pmem.db` Missing

Run:

```bash
pmem rebuild
```

If the project has no memory cards yet, add a module, decision, or task card first.

### `pmem ask` Returns No Matches

Try:

```bash
pmem recall --budget 2000
```

Then check whether the relevant card has useful `id`, `tags`, `aliases`, or `source_files` frontmatter.

### Non-Git Projects

`pmem status` uses `git status --porcelain` when available. Outside Git repositories it falls back to mtime scanning and writes `.pmem/.last-status`.

### FTS5 Unavailable

Some SQLite builds do not include FTS5. pmem falls back to `LIKE` search; this is slower but should not block normal use.

### Dirty Flags Remain

Run:

```bash
pmem update --suggest
pmem update --confirm -s "<summary>" -n "<next step>"
pmem verify
```

## Roadmap

**v0.5 Productization Beta** — shipped on npm as `pmem-ai`:
- README, quick start, and [usage guide](docs/usage.md)
- E2E suite, CI/CD, error UX, release checklist

**v0.6 Agent-native Workflow Polish** — shipped:
- Non-interactive init (`--description`/`--stage`/`--next` flags, `--answers` file)
- Claude Code slash commands (`/pmem-recall`, `/pmem-ask`, `/pmem-update`, `/pmem-distill`)
- Relationship auto-discovery across 6 languages (`pmem discover`)
- Inferred edge review and confirmation workflow
- False-positive guard: language builtins and external packages filtered out
- Actionable vs informational `ambiguous` classification (severity field)
- Actionable empty states and error messages
- Session fault tolerance
- Integration verification enhanced

Deferred:

- embedding
- `pmem serve` / MCP / REST
- Graph UI
- telemetry
- multi-user remote service

## License

MIT
