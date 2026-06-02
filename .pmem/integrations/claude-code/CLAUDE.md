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

`pmem update --suggest` exits 0 in v0.6.2+ even when suggestions exist. Parse JSON output such as `summary.has_actionable` instead of treating exit code 1 as a workflow signal.

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
