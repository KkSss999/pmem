# Changelog

All notable changes to pmem are documented here.

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
