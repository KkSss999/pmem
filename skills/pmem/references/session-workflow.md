# Session Workflow in Detail

Every agent session with pmem follows this pattern. pmem's value is in **cross-session recall**: the next time you open the project, `pmem recall` restores context instantly.

## Session Start

Always run these at the beginning of a session:

```bash
pmem session start -a "<agent-name>"
pmem recall --format compact --budget 2000
```

`pmem recall` output tells you:
- Project name, stage, current focus
- Recommended next step
- Active modules to read
- Recent update history
- Unresolved dirty flags count

## Before Focused Work

Before working on a specific module or task:

```bash
pmem ask "<topic>" --format compact
```

This finds relevant cards by:
1. Exact ID match (e.g., `module.core`)
2. Alias match
3. Tag match
4. Graph neighbor expansion (cards related to matched ones)
5. Keyword fallback (FTS5 full-text or LIKE)

## After Editing Code

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

Generates suggestions based on dirty flags and state freshness. **Exits with code 1 when suggestions exist** — this is a workflow signal, NOT a failure.

## Confirming Updates

```bash
pmem update --confirm -s "<summary of changes>" -n "<next step>"
```

Writes the confirmed changes and updates state/next files.

## Session End

```bash
pmem session end -s "<task summary>"
pmem verify
```

- `session end` summarizes the session's actions and affected cards
- `verify` checks consistency: manifest, database, card hashes, edges, stale memory

## Cross-Session Recall

The next day (or next session):

```bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
```

You immediately see what was done, what state the project is in, and what to do next — without re-reading source files or asking "where were we?"
