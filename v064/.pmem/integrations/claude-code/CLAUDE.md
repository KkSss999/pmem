# pmem integration for Claude Code

pmem keeps project memory in Markdown cards under .pmem/ and rebuilds SQLite indexes for fast recall. Markdown cards are the source of truth; do not edit .pmem/pmem.db directly.

## Session Start
```bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
```

## Before Focused Work
```bash
pmem ask "<task or module>" --format compact
```

## During Work (after editing files)
```bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
```

`pmem update --suggest` exits with code 1 when suggestions exist. That is a workflow signal, not a hard failure.

## Session End
```bash
pmem update --confirm -s "<summary>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
```

## Optional Hooks (.claude/settings.json)
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "command": "cd ${CLAUDE_PROJECT_DIR} && pmem mark-dirty -r \"File modified by Claude\""
    }]
  }
}
```
