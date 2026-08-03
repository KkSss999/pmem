# Session Workflow in Detail

Every agent session with pmem follows this pattern. pmem's value is in **cross-session recall**: the next time you open the project, `pmem recall` restores context instantly.

This workflow uses the model-free `pmem-ai` base package. It remains fully
available when semantic retrieval is not installed or temporarily unavailable.

## Session Start

Always run these at the beginning of a session:

```bash
pmem session start -a "<agent-name>"
pmem recall --format compact --budget 2000
```

`pmem recall` output tells you:
- Project name, stage, current focus
- Recommended next step
- Active foundational cards to read (`active_foundation` in JSON)
- Recent update history
- Unresolved dirty flags count

## Before Focused Work

Before working on a specific module, character, source, task, or topic:

```bash
pmem ask "<topic>" --format compact
```

This finds relevant cards by:
1. Exact ID match (e.g., `module.core`)
2. Alias match
3. Tag match
4. Graph neighbor expansion (cards related to matched ones)
5. Keyword fallback (FTS5 full-text or LIKE)

## After Editing Code (Recommended Flow)

If the completed change and next step are known, close the loop with one command:

```bash
pmem sync -s "<summary of changes>" -n "<next step>"
```

This detects changes, marks affected memory, records the update, and rebuilds the index.

## Review-Heavy Manual Flow

```bash
pmem status --format json
```

Detects changed files and maps them to affected memory cards. Uses `git status --porcelain` in git repos, mtime scanning outside.

```bash
pmem mark-dirty --auto
```

Marks affected cards as potentially stale in the database.

```bash
pmem update --suggest --format json
```

Generates suggestions based on dirty flags and state freshness. v0.6.2+ exits with code `0` whether suggestions exist or not. Parse JSON fields such as `summary.has_actionable`, `summary.blocking`, or `summary.verify_blocking` instead of using exit code `1` as a workflow signal.

## Confirming Updates

```bash
pmem update --confirm -s "<summary of changes>" -n "<next step>"
```

Writes the confirmed changes and updates state/next files.

Use the manual sequence when an agent needs to inspect suggestions before confirming them; it is not required for the ordinary daily loop.

## Session End

```bash
pmem session end -s "<task summary>"
pmem verify
```

- `session end` summarizes the session's actions and affected cards
- `verify` checks consistency: manifest, database, card hashes, edges, stale memory. Run `pmem verify --fix` or `pmem verify --fix-stale` to automatically fix stale mtime warnings and restore a 100/100 score.

## Cross-Session Recall

The next day (or next session):

```bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
```

You immediately see what was done, what state the project is in, and what to do next — without re-reading source files or asking "where were we?"

## Optional Semantic Enhancement

On macOS, a user may explicitly add the companion and enable semantic recall:

```bash
npm install -g pmem-ai-semantic@1.3.3
pmem semantic enable
```

This augments `ask` and `context`; it does not replace the deterministic engine
or change the ordinary session start/end workflow. If semantic readiness is
lost, continue the session with deterministic retrieval and use
`pmem semantic status` to diagnose the optional layer.
