# Skill: Code Task

Use this before modifying code.

## Required Reads
- .pmem/index.md
- .pmem/state.md
- .pmem/modules related to the target code
- .pmem/decisions related to the target module

## Required Writes
After task completion:
- Run `pmem status --format json`
- Run `pmem mark-dirty --auto`
- Run `pmem update --suggest --format json`
- Confirm the memory update with `pmem update --confirm -s "<summary>" -n "<next step>"`
- Run `pmem verify`

## Interpreting pmem verify
- **`clean`** or **warnings only**: proceed normally.
- **`active_lock`** (info, Score 100/100): another pmem process is rebuilding. Wait a few seconds and re-run `pmem verify`. Do NOT treat this as a failure.
- **`stale_lock`** (warning): a previous pmem process crashed. Run `pmem verify --fix-locks` to clean it.
- **`stale_index`**: the SQLite index is out of sync with markdown cards. Run `pmem rebuild`.
- **`too_many_relations`**: a card has too many relations. Check `pruning_candidates` in the output, or run `pmem relations <id> --format json`.
