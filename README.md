# pmem

Project Memory for AI Agents.

`pmem` is a local CLI runtime that helps coding agents remember a project: where it is, what changed, what matters next, and why. It stores project memory as Markdown cards in `.pmem/`, then builds SQLite indexes so agents can recall context with fewer tokens and update memory as code changes.

## Why pmem

Coding agents lose project context quickly. A repository has source files, docs, decisions, tasks, and traces, but the agent usually has to rediscover that context every session.

`pmem` gives the project a small, explicit memory layer:

- `pmem recall` restores the hot project context.
- `pmem ask "<query>"` finds relevant memory cards.
- `pmem discover` auto-discovers project relationships (tech stack, file deps, imports) across 6 languages.
- `pmem status` maps changed files back to affected cards.
- `pmem update --suggest` tells an agent what memory likely needs attention.
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
pmem recall --budget 2000
pmem verify
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

Use `recall` for the current project state:

```bash
pmem recall --budget 2000
```

Use `ask` for targeted retrieval:

```bash
pmem ask "sqlite runtime" --format compact
pmem ask "release checklist" --format json
```

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

`distill` consolidates trace cards into stable cards when enough evidence accumulates.

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
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
```

At session end:

```bash
pmem update --confirm -s "<what changed>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
```

Installed integration templates are available under:

```txt
.pmem/integrations/
```

## CLI Reference

```bash
pmem init [project-name] [--guided] [--domain software|novel|research]

pmem recall [--budget N] [--format compact|json|paths|pack]
pmem ask <query> [--format compact|json|paths|pack]
pmem discover [--dry-run] [--format compact|json] [--min-confidence 0.5]
              [--lang auto|nodejs,python,rust,go,cpp,java]
              [--pattern-file custom.json]
pmem related <id> [--depth N] [--type <edge-type>] [--format compact|json] [--source explicit|inferred|all]
pmem trace <id>

pmem status [--since <timestamp>] [--format compact|json]
pmem mark-dirty [-r <reason>] [--auto]
pmem update [--auto|--suggest|--apply-suggestion <id>|--confirm|--force] \
  [-s <summary>] [-n <next>] [--format compact|json]
  [--accept-edges <ids>] [--reject-edges <ids>]

pmem distill [--suggest|--apply-suggestion <id>|--confirm|--suggest-splits]
pmem rebuild [--changed|--full|--card <id>]
pmem verify [--fix]
pmem migrate --to 0.3 [--dry-run] [--backup]
pmem session start [-a <agent-name>]
pmem session end [-s <summary>]
pmem integration list|install <framework>|verify
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
