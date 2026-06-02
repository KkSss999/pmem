# AGENTS.md

This project uses pmem for project memory.

pmem stores source-of-truth memory as Markdown cards under `.pmem/` and rebuilds SQLite indexes for fast agent recall. Do not edit `.pmem/pmem.db` directly.

## Session Start

```bash
pmem session start -a "Codex"
pmem recall --format compact --budget 2000
```

For specific work, ask pmem first:

```bash
pmem ask "<task or module>" --format compact
```

## Read

Only read memory cards returned by pmem unless more context is needed.

## After Editing Code

```bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
```

`pmem update --suggest` exits 0 in v0.6.2+ even when suggestions exist. Parse JSON output such as `summary.has_actionable` instead of treating exit code 1 as a workflow signal.

## Session End

Before finishing work:

```bash
pmem update --confirm -s "<what changed>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
```

## Source Of Truth

- Markdown cards in `.pmem/**/*.md` are canonical.
- `.pmem/pmem.db` is a rebuildable SQLite runtime index.
- Run `pmem rebuild` after changing memory cards.

## More Workflows

Task-specific workflows are in:

```txt
.pmem/skills/
```
