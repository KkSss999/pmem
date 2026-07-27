# AGENTS.md

This project uses pmem for project memory.

pmem stores source-of-truth memory as Markdown cards under `.pmem/` and rebuilds SQLite indexes for fast agent recall. Do not edit `.pmem/pmem.db` directly.

## Local CLI Rule

When working **in this pmem repository**, never use the bare `pmem` command to inspect or mutate project memory: it may resolve to an older globally installed package. Use the repository-local CLI below, which rebuilds `dist/` from the current checkout before running:

```bash
npm run pmem:local -- <command>
```

Use bare `pmem` only when validating a separately installed published package. Always state whether a result came from the local checkout or a published npm package.

## Session Start

```bash
npm run pmem:local -- session start -a "Codex"
npm run pmem:local -- recall --format compact --budget 2000
```

For specific work, ask pmem first:

```bash
npm run pmem:local -- ask "<task or module>" --format compact
```

## Read

Only read memory cards returned by pmem unless more context is needed.

## After Editing Code

```bash
npm run pmem:local -- status --format json
npm run pmem:local -- mark-dirty --auto
npm run pmem:local -- update --suggest --format json
```

`pmem update --suggest` exits 0 in v0.6.2+ even when suggestions exist. Parse JSON output such as `summary.has_actionable` instead of treating exit code 1 as a workflow signal.

## Session End

Before finishing work:

```bash
npm run pmem:local -- update --confirm -s "<what changed>" -n "<next step>"
npm run pmem:local -- session end -s "<task summary>"
npm run pmem:local -- verify
```

## Source Of Truth

- Markdown cards in `.pmem/**/*.md` are canonical.
- `.pmem/pmem.db` is a rebuildable SQLite runtime index.
- Run `npm run pmem:local -- rebuild` after changing memory cards.
- Do not create or retain a repository `docs/` directory. Record durable plans,
  decisions, release context, and handoffs as `.pmem` cards instead.

## More Workflows

Task-specific workflows are in:

```txt
.pmem/skills/
```
