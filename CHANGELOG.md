# Changelog

All notable changes to pmem are documented here.

## 0.6.4 - Polish & Wrap v0.6 Track

### Added

- `pmem rename`: byte-level body whitespace preservation (frontmatter end → body start transitions are no longer normalized).
- `pmem rename --dry-run`: frontmatter field scan (`aliases` / `tags` / `related` / `depends_on`) reports matches without modifying on `--write`.
- `pmem integration install claude-code`: generates real `.claude/settings.json` (was `.example.json` placeholder).
- `pmem integration install cursor`: generates 4 slash command files in `.cursor/commands/` (Cursor 0.46+ convention).
- `pmem integration install codex`: AGENTS.md template now includes a `## Commands` section with concrete `pmem` invocations.
- `pmem integration verify`: reads `pmem_integration_version` from actual installed files (not just manifest), reports per-file `match / unknown / mismatch` state.
- `pmem doctor` lock check: shows owner PID, age in seconds, stale threshold, and explicit next-step fix hints for active and stale lock states.
- `pmem init --guided`: when any of `--description` / `--stage` / `--next` is missing, prints a `Missing: ...` block with the equivalent re-run command before continuing.

### Fixed

- `pmem rebuild --full` was clearing the `sessions` table without restoring in-progress sessions, causing `pmem session end` to report "No active pmem session found" after a recovery-time rebuild. Snapshot + clear + restore now runs **inside the same SQLite transaction** as the card rebuild, eliminating the non-atomic window. Root cause: `clearAllTables()` includes `DELETE FROM sessions` but sessions are runtime state, not derived from markdown cards.

### Changed

- `CURRENT_TEMPLATE_VERSION` bumped from `0.6.0` to `0.6.4` (was a missed constant update from earlier polish work; now correctly matches the publishing version).

### Design evaluations (no implementation)

- `pmem session start --create-if-missing`: **deferred to v0.7.0+**. Risk of masking wrong-directory use outweighs the 5-second friction saved. No comparable agent tool (Claude Code / Cursor / Codex) auto-creates project memory on first session. See `docs/session-start-create-design-eval.md`.

### Known non-blocking (carry-over)

- `pmem_integration_version` YAML serialization relies on `parseSimpleYaml` handling of double-quoted strings; single-quoted strings would be misread. Single-quote use is not exposed in any current template. Tracked for v0.7.0 parser hardening.
- `update_log` / `dirty_flags` may still reference session_id values that were rolled back by an interrupted pre-v0.6.4 rebuild. Historical data only; no functional impact. Tracked for v0.7.0 integrity tightening.

## 0.6.3 - Relationship Auto-Discovery

### Added

- `pmem discover`: auto-discover project relationships across 6 languages (Node.js, Python, Rust, Go, C/C++, Java). Two-layer discovery: source file imports (regex, confidence 0.7) and package manager dependencies (package.json/Cargo.toml/go.mod/etc., confidence 0.7-0.85).
- `pmem discover --dry-run`: preview discoveries without writing to database.
- `pmem discover --lang <langs>`: filter to specific languages (auto-detect by default).
- `pmem discover --pattern-file <path>`: custom language pattern JSON for additional ecosystems.
- `pmem discover --min-confidence <0-1>`: threshold for edge creation (default 0.5).
- `pmem related --format json`: structured output with confidence/source per edge, grouped by `high_confidence` vs `needs_review`.
- `pmem related --source explicit|inferred|all`: filter edges by source.
- `pmem update --confirm --accept-edges <ids>`: promote inferred edges to explicit (confidence 1.0).
- `pmem update --confirm --reject-edges <ids>`: delete rejected inferred edges.
- `pmem update --suggest` now includes low-confidence inferred edges as suggestions.
- Agent-configurable language patterns via manifest `discover.additional_patterns`.

### False-Positive Guard

- `BUILTIN_MODULES` per-language skip list: Node.js core modules (`fs`, `path`, `crypto`, `child_process`, etc.), Python stdlib, Go stdlib, Java `java.*`/`javax.*`/`jakarta.*`/Spring/JUnit, C/C++ standard headers, Rust std crates. These are silently dropped from `discovered_edges` and `ambiguous` so the agent only sees actionable items.
- New `AmbiguousRelation.kind = 'external_unmatched'` and `severity` field. Bare-name imports (npm packages, third-party libs) and dep-file entries with no matching card are classified as `severity: 'informational'`, distinct from `severity: 'actionable'` for internal project files missing a card.
- Discover result `summary` now reports `actionable` and `external_refs` counts. Compact output shows actionable items first, then a collapsed count for informational ones.

### Changed

- `pmem rebuild` (incremental) now preserves inferred edges (only deletes/recreates explicit edges).
- `pmem related` compact output shows `[inferred, 0.7]` tags on non-explicit edges.
- `pmem trace` now shows edge source and confidence annotations.

### Internal

- New `src/core/discover/` module: `index.ts` (orchestration), `patterns.ts` (6-language registry), `detect.ts` (auto-detection).
- New edge CRUD in `src/core/db.ts`: `deleteInferredEdges`, `getInferredEdges`, `getEdgesForCard`, `updateEdgeSource`, `deleteEdgesByIds`, `getOrphanEdges`, `deleteExplicitCardEdges`.
- New types in `src/types.ts`: `DiscoverResult`, `DiscoveredEdge`, `AmbiguousRelation`, `LanguagePattern`, `ManifestDiscoverConfig`.

## 0.6.2 - Real-User Friction Fixes

### Added

- `pmem rename --find <text> --replace <text>`: batch text replacement in memory card bodies. Default preview, `--write` to apply. Body-only, frontmatter preserved byte-for-byte.
- `pmem verify --fix-locks`: detect and clean stale locks at `.pmem/.lock`.
- `pmem verify --relaxed`: temporarily double all `card_policy.max_tokens` limits.
- `pmem doctor` lock status check: reports no lock / stale lock / active lock with fix guidance.
- `pmem recall --since <duration>`: filter cards by update time (e.g. `--since 7d`, `--since 24h`). Uses ISO 8601 parameterized SQL contract.
- `pmem new <type> "<title>"`: generate memory card files with valid YAML frontmatter templates. Validates type and title at creation time.
- `pmem integration install git-hooks`: install pre-commit hook running `pmem verify --relaxed`.
- `acquireLock()` auto-cleans stale locks (60s+) before retrying, eliminating a common `pmem update --confirm` failure mode.

### Changed

- **BREAKING:** `pmem update --suggest`, `pmem status`, and `pmem distill --suggest` no longer exit `1` when results exist. All normal results exit `0`; runtime errors exit `2`. Exit code `1` is no longer used as a workflow signal. Scripts checking `$? -eq 1` must parse JSON output instead.
- Lock acquisition failure message in `pmem update --confirm` now guides users to `pmem verify --fix-locks` and `pmem doctor`.
- `rebuild` now guarantees `cards.updated_at` is always populated (ISO 8601), using fallback chain: frontmatter.updated → file mtime → rebuild timestamp.
- Card policy default token limits adjusted: `decision 800→1000`, `task 600→800`.

### Fixed

- Doctor session query bug: `ORDER BY created_at` → `ORDER BY started_at` (sessions table has no `created_at` column).
- `pmem rename --find ""` rejected with clear error and exit 2 (empty pattern safety).

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
