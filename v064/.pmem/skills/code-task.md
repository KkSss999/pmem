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
