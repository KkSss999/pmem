# Skill: Update Memory

Use this after completing a task.

## Must Update
- state.md when project state changed
- next.md when the next recommended action changed
- traces/YYYY-MM-DD-*.md when work completed

## Write-Path Contract (v0.7.6)
`pmem update --confirm` preserves existing card content:
- It only writes to `.pmem/state.md`, `.pmem/next.md`, and trace files.
- It NEVER overwrites module, decision, task, or other memory cards.
- Agent-authored frontmatter fields (`last_verified`, `updated`) are merged without removing user content.

## Lock Protocol
`pmem update --confirm` holds `.pmem/.lock` during writes. If you see `pmem verify` report `active_lock` while an update is in progress, this is expected — wait and re-run verify.

## Add Decision When
- Architecture changed
- Product direction changed
- Major tradeoff was made
- A previous assumption was invalidated
