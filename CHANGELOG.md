# Changelog

All notable changes to pmem are documented here.

## 0.6.1 - Actionable Update Suggestions

### Added

- Aggregate duplicate `update --suggest` items by `target + reason + matched_file`, with counts and `sources` arrays.
- Split suggestion output into `blocking_for_verify`, `current_suggestions`, and `historical_dirty_flags` groups.
- Add machine-readable severity metadata per suggestion: `severity`, `blocks_verify`, `is_duplicate`, `is_historical`.
- Compact output summarizing affected cards, blocking issues, hidden duplicates, and hidden history.
- `--include-history` flag to inspect historical dirty flags that are hidden by default.
- Shared `checkStaleMemory()` in `src/core/consistency.ts`, aligning `update --suggest` with `pmem verify`.
- Structured JSON output with `summary`, `message`, `next_steps`, and `groups` for agent decision-making.
- v0.6.1 E2E test suite covering duplicate aggregation, historical hiding, include-history, missing DB, and blocking groups.

### Changed

- `update --suggest --format json` output restructured from flat arrays to `summary` + `groups`.
- `pmem verify` stale-memory check now delegates to shared `checkStaleMemory()` from `consistency.ts`.
- `update --suggest` exit code: only hidden historical items return 0; missing/corrupt DB returns 2 (runtime error).

### Fixed

- Long-term projects no longer see repeated dirty flags and historical suggestions flooding `update --suggest` output.
- `pmem verify` 100/100 and `update --suggest` now semantically aligned — verify-clean projects see "No blocking memory consistency issues."

## 0.6.0 - Agent-native Workflow Polish

### Added

- Non-interactive init: `--guided` now accepts `--description`, `--stage`, `--next` flags and `--answers <file.json>` for agent/script usage.
- Claude Code slash commands: `pmem integration install claude-code` generates `.claude/commands/pmem-*.md` (recall, ask, update, distill).
- `update --suggest --format json` output includes `message` and `next_steps` for empty scenarios.
- `ask --format json` output includes `message` and `next_steps` when no matches found.
- `pmem integration verify` checks slash command files and gives fix instructions for all frameworks.
- Global skills installation: `pmem install --skills --claude/--codex/--gemini/--all` copies `skills/pmem/` to agent global skills directories.
- `pmem doctor`: unified diagnostic command checking 8 aspects of project memory health.
- Agent-native E2E suite: non-interactive init, answers file, claude integration, empty guidance, non-git UX.

### Changed

- `mark-dirty --auto` checks git availability before running git commands; gives friendly guidance instead of raw stack traces.
- `pmem session end` without an active session now provides actionable next steps.
- `pmem rebuild` differentiates missing `.pmem` from missing `manifest.yml`.
- Updated docs: README, CLAUDE.md, AGENTS.md, and integration templates to v0.6 scope.

### Fixed

- `pmem install-smoke` E2E version check now reads expected version from `package.json` dynamically.

## 0.5.0 - Productization Beta

### Added

- Added user-facing `README.md` with install, quick start, core concepts, agent workflow, CLI reference, exit codes, and troubleshooting.
- Added npm package readiness metadata: repository, bugs, homepage, engines, files whitelist, and expanded keywords.
- Added MIT `LICENSE`.
- Added install smoke E2E script: `npm run test:e2e:install`.
- Added real memory workflow E2E script: `npm run test:e2e:workflow`.
- Added `parseGitStatusPorcelain` helper with tests for modified, added, untracked, and renamed files.
- Added v0.5 pre-design and implementation plan docs.

### Changed

- Updated CLI version to `0.5.0`.
- Updated `AGENTS.md` and `CLAUDE.md` to the v0.5 Productization Beta scope.
- Updated `pmem init` generated AGENTS and integration templates with v0.5 workflow instructions.
- Tightened npm tarball contents to runtime files, README, LICENSE, and top-level docs.

### Fixed

- Fixed git porcelain parsing for modified files whose status begins with a leading space, such as ` M src/index.ts`.
- Fixed `mark-dirty --auto` and `status` path detection by sharing the same porcelain parser.

## 0.4.0 - Agent Workflow Automation

- Added `pmem status`.
- Added `mark-dirty --auto`.
- Added `update --suggest` and `update --apply-suggestion`.
- Added `distill --suggest` and `distill --apply-suggestion`.
- Added session update log summary.
- Added hooks-friendly JSON output and exit code contracts.
- Added Claude Code, Cursor, and Codex integration templates.

## 0.3.0 - SQLite Runtime

- Introduced `.pmem/pmem.db` as the primary runtime index.
- Added SQLite-backed cards, edges, aliases, tags, paths, dirty flags, sessions, and update logs.
- Added content-hash incremental rebuild.
- Added FTS5-backed search when available, with fallback behavior.

## 0.2.0 - File Mode Trust

- Added guided initialization.
- Added schema migration.
- Added atomic writes and file locks.
- Added card policy validation.
- Added initial distillation workflow.

## 0.1.0 - Core Loop

- Added initial CLI loop: init, rebuild, recall, ask, related, trace, verify, update, mark-dirty, and integration commands.
- Established Markdown cards as the source of truth.
