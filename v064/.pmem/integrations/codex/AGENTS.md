# pmem + Codex Integration

## Quick Start
```bash
pmem session start -a "Codex"
pmem recall --format compact --budget 2000
```

## Memory-Aware Workflow
1. Start task: `pmem ask "<task description>" --format compact`
2. Edit code
3. Inspect changes: `pmem status --format json`
4. Mark changes: `pmem mark-dirty --auto`
5. Get suggestions: `pmem update --suggest --format json`
6. Treat exit code 1 from suggest commands as "action suggested", not failure
7. Apply: `pmem update --confirm -s "<what changed>" -n "<next step>"`
8. End session: `pmem session end -s "<summary>" && pmem verify`

## Source Of Truth
Markdown cards under `.pmem/` are canonical. `.pmem/pmem.db` is a rebuildable SQLite runtime index.
