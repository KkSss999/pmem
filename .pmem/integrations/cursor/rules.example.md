# Cursor Rules with pmem

## Session Start
In Cursor's AI chat: `pmem session start -a "Cursor" && pmem recall --format compact --budget 2000`

## Before Focused Work
`pmem ask "<task or module>" --format compact`

## When Editing Code
After each significant change: `pmem status --format json && pmem mark-dirty --auto`

## Before Requesting Review
`pmem update --suggest --format json`

In v0.6.2+, `pmem update --suggest` exits 0 even when suggestions exist. Parse JSON output to decide whether action is needed.

## End of Session
`pmem update --confirm -s "<summary>" -n "<next>" && pmem session end -s "<summary>" && pmem verify`

## Source Of Truth
Markdown cards under `.pmem/` are canonical. SQLite indexes are rebuildable runtime data.
