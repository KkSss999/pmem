# Changelog

All notable changes to pmem are documented here.

## v1.3.2 — Semantic Quality and Context Packaging (2026-08-03)

### Added

- **ContextPack contract**: CLI, SDK, and MCP now expose the Runtime-generated structured memory payload with records, evidence, provenance, budget, diagnostics, and schema version.
- **Semantic quality gates**: deterministic golden fixtures cover precision, recall, MRR, nDCG, context token efficiency, and noise.
- **Evidence quality controls**: validated SQLite provenance survives Runtime fusion, evidence receives reserved budget, each record is capped at three evidence items by default, and deterministic diversity ordering reduces redundant context.
- **Unified semantic distribution**: `pmem-ai` remains the single user-facing CLI entry while `pmem-ai-semantic` ships as the separately distributed local execution component; the root package includes the packaged `skills/` directory.

### Compatibility

- The base CLI and semantic companion advance together to `1.3.2`.
- Deterministic, exact, lexical, graph, and fusion ranking remain authoritative; semantic retrieval remains a degradable perception channel.
- Markdown cards remain canonical; ContextPack is a structured memory payload rather than a prompt template.

## v1.3.1 — Semantic Runtime Default (2026-08-02)

### Added

- **Semantic Runtime Default**: opening a compatible project now records the pinned local semantic model contract without downloading model assets implicitly.
- **Automatic semantic lifecycle**: successful Runtime captures trigger best-effort incremental semantic refresh; canonical capture remains successful when semantic assets are unavailable.
- **Versioned semantic metadata**: receipts and SQLite semantic indexes record metadata version, model coordinates, dimension, and heading-aware chunk strategy.
- **Production validation**: the pmem repository's own `.pmem` root has a complete `44 cards / 646 chunks` semantic index and a successful Runtime capture refresh.

### Compatibility

- The base CLI and optional `pmem-ai-semantic` companion advance together to `1.3.1`.
- Deterministic, exact, lexical, graph, and fusion ranking remain authoritative; semantic retrieval remains a degradable perception channel.
- `pmem semantic clear` records an explicit `auto_enabled: false` opt-out and preserves the model cache.

## v1.2.4 — Maintenance and Retrieval Reliability (2026-08-02)

### Added

- **Unified maintenance workflow**: `pmem maintain` previews or explicitly applies metadata repair, deterministic rebuild, and optional semantic rebuild with structured recovery guidance.
- **Project-root discovery**: commands can resolve the nearest project `.pmem` directory from subdirectories, with lock diagnostics and domain-aware health thresholds.
- **More useful query output**: `ask` exposes browse-style results and safe snippets, while `recall` restores foundation and recent-trace context within the requested budget.
- **Retrieval quality safeguards**: factual queries preserve graph provenance and small-project evaluation fixtures cover ranking regressions.

### Fixed

- Oversized semantic chunks are bounded, and card-level embedding failures now produce partial/failed index status instead of an apparently ready index.
- Semantic companion loading resolves its own Transformers runtime and reports actionable install/version errors.
- Health metadata creation, verification, and migration now preserve trust/sensitivity provenance and provide actionable repair hints.
- Project-root, lock, non-Git, and domain-specific paths are handled consistently across rebuild, status, verify, health, semantic, and query commands.

### Compatibility

- The base CLI and optional `pmem-ai-semantic` companion advance together to `1.2.4`.
- Markdown cards remain canonical; SQLite, semantic chunks, vectors, and query fixtures remain rebuildable derived data.
- Linux remains unsupported for semantic retrieval. Windows semantic setup remains locally covered by packaging smoke tests, not by a fresh real-machine acceptance in this release preparation.

## v1.2.3 — Windows Semantic Retrieval (2026-07-29)

### Added

- **Windows joins macOS as a supported platform for semantic retrieval**: `pmem semantic setup`/`enable` now accept `win32` in addition to `darwin`. Verified end to end on a real Windows machine — model download/cache, `pmem semantic rebuild`, and `pmem ask --explain` returning a semantic-scored (cosine) match fused with deterministic candidates.

### Fixed

- **`pmem-ai-semantic`'s absolute-path check rejected every Windows path**: `createOfflineTransformersProvider` checked `cachePath.startsWith('/')`, which is never true for a Windows path (`C:\...`), so semantic setup failed at the rebuild step even after the platform gate was lifted. Replaced with `path.isAbsolute()`.

### Compatibility

- Linux remains unsupported for both the base CLI and the semantic companion.
- No behavior change on macOS; the underlying retrieval pipeline, model, and storage boundary are unchanged.

## v1.2.2 — Windows Compatibility (2026-07-29)

### Fixed

- **`atomicWrite` no longer throws `EPERM` on Windows**: the temp file used for atomic writes was opened read-only (`'r'`) before `fsync`, which Windows rejects. Every card/index write that went through `atomicWrite`/`writeJson` was affected.
- **Relative paths are normalized to `/` before being persisted or compared**: `rebuild`, `recall`, module inference, and health migration built card `file_path` values and directory-prefix checks directly from `path.relative()`, which returns `\`-separated paths on Windows. A new `toPosixPath()` helper is now applied at every such call site; this also fixes `candidates/`/`skills/`/`integrations/` directory filtering in `rebuild`, which silently matched nothing on Windows.

### Compatibility

- **Windows joins macOS as a mandatory supported platform** for the base CLI, SDK, and runtime (`pmem-ai`), superseding the macOS-only platform policy from v1.1.1 for this scope. Linux remains unsupported. The semantic companion (`pmem-ai-semantic`) remains macOS-only.
- No behavior change on macOS/Linux; fixes are path-normalization and fsync-mode corrections, not platform-specific branches.

## v1.2.1 — Deep-Usage Reliability (2026-07-25)

### Added

- **Meaningful card IDs**: `pmem new` accepts `--id` for stable, human-readable identifiers, with namespace/type/collision validation and the existing generated-ID behavior as the default (#21).
- **Actionable retrieval diagnostics**: explain and zero-result responses report aggregate trust-label exclusions without exposing card IDs, paths, content, or secrets (#20).
- **Semantic out-of-domain abstention**: low-relevance semantic queries now return no semantic candidates instead of flooding results with flat, unrelated scores (#25).

### Fixed

- Invalid Markdown cards are reported once per file during rebuild while valid siblings continue indexing; a formerly valid card that becomes invalid is removed from derived indexes (#19).
- Non-Git dirty detection now uses canonical content fingerprints, distinguishes new from modified cards, survives repeated `status` calls, and only acknowledges the exact handled file version (#22, #27).
- `pmem forget` now fails for unknown card/event IDs and never appends a false tombstone (#23).
- `pmem doctor` now uses the same success semantics in text and JSON modes, distinguishes warnings from errors, diagnoses stale/empty indexes, and gives concrete recovery commands (#24, #26).
- `pmem context --format json` emits stable, deduplicated `changed_files` entries (#28).

### Compatibility

- The base CLI and optional `pmem-ai-semantic` companion advance together to `1.2.1`; Markdown cards and derived database formats remain backward compatible.
- Existing semantic security boundaries remain unchanged: missing, invalid, untrusted, non-indexable, secret, deleted, and superseded content is excluded before local inference.

## v1.2.0 — Unified Memory Intelligence (2026-07-24)

### Added

- **Ready-after-init experience**: fresh projects build their first deterministic index during `pmem init`, so `recall`, `ask`, and `context` work immediately without a separate rebuild command.
- **One-step semantic enablement**: `pmem semantic enable` guides companion validation, explicit model setup, and current-project indexing while preserving the expert `setup` and `rebuild` operations.
- **Transactional two-package delivery**: CI packs, installs, audits, and smoke-tests both npm artifacts; main-branch releases publish and verify the semantic companion before publishing the base CLI that documents it.
- **Opt-in local semantic retrieval for macOS**: `pmem semantic setup/status/rebuild/clear` manages a pinned multilingual E5 ONNX model and a derived SQLite vector index. ModelScope is the default download source; Hugging Face remains available with `--source huggingface`.
- **Isolated semantic runtime**: the base `pmem-ai` production install no longer includes Transformers.js, ONNX Runtime, or sharp. Local inference is enabled explicitly by installing the separately distributed `pmem-ai-semantic@1.2.0` companion.
- **One global model cache**: model artifacts are shared across projects under `~/.pmem-global/models/<model>/<revision>`; project-local `.pmem` stores only configuration and derived chunk vectors.
- ModelScope and Hugging Face are interchangeable download mirrors for the same verified global artifact; switching source does not duplicate or invalidate the cache.
- **Hybrid semantic + graph recall**: semantic chunk hits collapse to parent cards before graph expansion and expose similarity, chunk, heading, model revision, and parent-card provenance in explain output.
- **Local contextual reranking**: deterministic query planning and a bounded TypeScript second stage improve ordering without another model or cloud service. Exact ID/title/path authority and graph provenance remain intact.
- **Contextual index pipeline v2**: safe card metadata and relationship context are versioned separately from Markdown source; incompatible derived indexes degrade safely until rebuilt.
- **Memory Health**: `pmem verify` now reports backward-compatible `score` plus overall, change, and correctness/freshness/metadata/semantic-readiness dimensions. Repeated stale evidence is aggregated per card and penalties remain meaningful for mature repositories.
- **Explicit health baseline**: `pmem health baseline --write` accepts current project-specific debt so later verification distinguishes historical and newly introduced issues.
- **Safe metadata migration**: `pmem health migrate` is dry-run by default; apply requires explicit trust/sensitivity choices, creates a backup, holds the project lock, rolls back failures, rebuilds the index, and only fills missing fields.
- **Versioned retrieval evaluation**: 60 labelled Chinese, English, and code/path queries plus a 300-card performance fixture lock quality, exact-authority, and latency baselines.

### Security

- Embedding input is allowlisted before provider invocation. Secret, untrusted/imported/agent-generated, candidate, deleted, and superseded memory never reaches the model or semantic tables.
- Model downloads require explicit setup confirmation, use pinned revisions and integrity receipts, and inference disables remote model loading after setup.

### Compatibility

- Semantic retrieval is disabled by default, so install, init, rebuild, ask, and context retain their deterministic offline behavior and never download a model.
- Markdown cards remain canonical; semantic chunks and vectors are rebuildable derived data. `pmem semantic clear` disables and clears the project index without deleting the shared model cache.
- Existing compact verify output, top-level `score`, warning exit behavior, manifests, and Markdown cards remain compatible; new health fields and commands are additive.

## v1.1.0 — System Memory Security (2026-07-23)

### Added

- **9-level namespace hierarchy**: `system` → `user` → `application` → `workspace` → `agent` → `task` → `session`, plus `private` and `shared`. `ScopeManager` gains `parentScope()`, level-based `children()`, and namespace-address inference in `resolve()`.
- **Capability ACL (12 capabilities)**: `MemoryCapability` (`read`/`search`/`observe`/`propose`/`commit`/`amend`/`supersede`/`forget`/`purge`/`share`/`export`/`admin`) with per-principal grants, scope inheritance (`agent:x` → `agent:x:*`), and `memory.admin` full propagation. `observe`/`forget`/`capture` are guarded and authorize the **calling principal**. When no capabilities are registered, behavior matches v1.0 (read/search open).
- **Agent quotas**: `PolicyEngine.setQuota()` enforces per-principal observe/capture limits; exceeding a limit throws `QuotaExceededError`. Capability checks run before quota so a denied operation does not consume quota.
- **Branch memory merge**: `mergeBranchMemory(source, target, principal)` migrates event-store scopes; guarded by `memory.admin`.
- **Memory poisoning defense**: `pmem verify` gains `checkMemoryPoisoning()` (>20% untrusted-ratio warning, `untrusted_fact` conflict detection, `agent_only_decision` info) alongside `trust_labels` checks.
- **Trust-aware recall & scoring**: `sensitivity`, `trust_label`, `classification`, `confidence`, and `superseded_by` are persisted to the SQLite `cards` table and surfaced in `recall`/`ask`. `confidence` boosts/penalizes and `superseded_by` down-weights results in scoring.

### Security

- **ACL authorizes the calling principal**: capability checks validate the principal making the request rather than granting when *any* registered principal holds the capability.
- **`secret` sensitivity is filtered from agent context**: secret-sensitivity cards are excluded at the query source (`recall`/`ask`) and in output formatting.
- **Namespace read isolation**: `recall` accepts an optional `principal` and filters scoped events through a fail-safe visibility check — unknown principals are treated as least-privileged (no fail-open); `shared`/legacy (`project`/`branch:*`) scopes remain visible for compatibility.
- **`secret` filtering covers all read paths**: in addition to `recall`/`ask`/`context`, secret-sensitivity cards are excluded from recall foundational lists (`mustRead`/`active_foundation`/`active_modules`), the relation graph (`related`/`pmem_related`), and the `pmem trace`/`graph` CLI (secret main card reports not-found; secret evidence/dependency targets and card bodies are never printed). A secret main card reports not-found and secret relation targets are omitted (with `total_edges` reflecting only visible edges).

### Changed

- **`cards` schema**: added `confidence`, `superseded_by`, `classification`, `trust_label`, `sensitivity` columns with idempotent migration for existing databases.
- **Version**: package and MCP schema version aligned to `1.1.0`.

### Compatibility

- All new frontmatter fields and the `capabilities`/`principal` options are optional; existing cards, CLI commands, MCP tools, and SQLite databases remain backward compatible (auto-migrated on open).
- Deferred: full card-level per-principal read isolation, public `Pmem.open()` wiring for quota registration, and the v1.1 pre-design's Rust daemon/IPC/SLOs.

## v1.0.2 — Trust & Delivery (2026-07-23)

### Added

- **`trust_label` and `sensitivity` frontmatter**: 7 trust levels (`system_trusted` → `untrusted_content`) and 5 sensitivity levels (`public` → `secret`). Surfaced by `verify` and recall display.
- **Module boundary contracts**: `contract` frontmatter (owner/interface/invariants/verification) with `checkModuleContracts()` (`missing_contract_field`) in `pmem verify`.
- **Auto-distill urgency**: `getDistillUrgency()` classifies trace backlog (`suggest` ≥ 10, `recommended` ≥ 20, `urgent` ≥ 40); `pmem capture` suggests distillation after capture.
- **Doc-pmem sync drift**: `checkDocSync()` reports `missing_source_file` (referenced source deleted) and `untracked_card` (no `source_files` to track).

### Fixed

- **Doc-sync double-reporting**: `pmem verify` no longer reports `missing_source_file`/`untracked_card` twice (aggregate `verifyMemory()` now excludes types handled by dedicated blocks).

## v1.0.1 — Agent-Trust Operations (2026-07-22)

### Added

- **Agent-trust frontmatter**: `confidence` (0–1 reliability), `superseded_by` (card IDs that replace this one), and `classification` (`fact`/`decision`/`assumption`/`plan`/`risk`/`question`).
- **5 new `pmem verify` checks**: `low_confidence`, `unclassified_card`, `superseded_reference`, `stale_next_step`, `conflicting_classifications`.
- **Structured next-step queue**: `parseStructuredNext()` extracts `[P0]`/`[P1]`/`[P2]` priority, `@owner`, and acceptance-criteria sub-bullets from `next.md`; rendered by `pmem context`.

## v1.0.0 — Agentic Memory Runtime (2026-07-22)

### Added

- **`Pmem` Runtime & SDK**: Embeddable `Pmem.open()` API with query methods (`ask`, `recall`, `context`, `related`, `status`) and write methods (`observe`, `forget`, `capture`, `endSession`). Package exports at `pmem-ai` (SDK) and `pmem-ai/runtime` (full internals).
- **Scope Manager**: `project` → `branch` → `session` → `agent` → `private` hierarchy with git branch-aware resolution.
- **Policy Engine**: Confirmation gating (required/optional/never), TTL-based expiry, duplicate detection.
- **Event Store**: Append-only SQLite event log with branch-aware working memory and durable tombstones.
- **`pmem forget` command**: Durable tombstone for memory cards with audit event and confirm gate.
- **MCP write tools**: `pmem_observe`, `pmem_forget` (append-only mode), gated behind `--write=append-only`. All 8 tool schemas hardened with `additionalProperties: false` and path scope validation.
- **Preset system**: `software` (default), `research`, `novel` presets with configurable memory policies.
- **Independent SQLite instances**: `openOwnedDatabase()` replaces singleton — multi-instance safe.

### Changed

- **Types modularized**: `src/types.ts` → `src/types/` (9 domain files).
- **CLI routing**: Read commands (`ask`, `recall`, `status`, `context`, `relations`) and `capture` route through `Pmem.open()`.
- **MCP server**: All tools route through single `Pmem` instance. Version aligned to package `1.0.0`.
- **SDK type exports**: Full TypeScript types for all query results, options, write operations, and domain models.

### Compatibility

- Markdown cards remain canonical, editable, Git-managed
- SQLite indexes/runtime state rebuildable via `pmem rebuild`
- All existing CLI commands and output contracts preserved
- `sync`, `update`, `verify`, `session`, `rebuild` remain command-native

## v0.7.6-a — Stale Card Cleanup & missing_card_file Fix (2026-06-29)

### Fixed

- **`missing_card_file` rebuild dead loop (#12)**: `pmem verify` previously reported `missing_card_file` and suggested `pmem rebuild`, but incremental rebuild only processed existing `.md` files on disk and never cleaned up DB rows for deleted cards — creating an unresolvable loop. Incremental rebuild now detects stale DB cards whose source files no longer exist, marks them `is_deleted = 1`, and cleans up their edges/aliases/tags/paths.
- **`deleteOrphanEdges` now runs unconditionally**: Previously only called during `--full` rebuild; now runs in all rebuild modes since stale card cleanup can create new orphan edges in incremental mode.
- **`--fix` / `--fix-stale` directly handle `missing_card_file`**: Before calling rebuild, these options now directly remove stale card rows from the database, providing an immediate repair path without waiting for index rebuild.

### Changed

- **Verify fix hint updated**: `missing_card_file` now suggests `"pmem rebuild (incremental rebuild will clean up stale card references)"` instead of just `"pmem rebuild"`.
- **`card_id` added to `missing_card_file` verify issues**: Enables direct DB cleanup by `--fix` / `--fix-stale`.
- **Rebuild summary reports cleaned stale cards**: `"Cleaned N stale card(s) (source files deleted)"` when applicable.

## v0.7.6 — Agent Contract & Write-Path Integrity (2026-06-28)

### Added

- **Lock Protocol**: `pmem rebuild` and `pmem update --confirm` acquire `.pmem/.lock` during index mutations. `pmem verify` acquires the lock before reading the SQLite index. Concurrent verify during an active rebuild emits `active_lock` (info) and defers freshness checks instead of producing transient `stale_index` warnings. Stale locks (>60s, from crashed processes) are auto-cleaned on acquisition and can be manually cleaned with `pmem verify --fix-locks`. Reentrant: nested calls (e.g. `update --confirm` → `rebuildCommand`) share the same lock without deadlock.
- **`pmem relations <id> --format json`**: Inspect a card's edge graph with `outgoing`/`incoming` edges, `summary_by_type`, `summary_by_source`, and `pruning_candidates` (edges with `source: inferred` or `confidence < 0.5`).
- **`too_many_relations` verify output**: When a card exceeds its relation threshold, `pmem verify` now includes `top_edges` (up to 10 lowest-confidence edges) and `pruning_candidates` in the issue, so agents can identify which relations to prune.
- **`content_trust: "untrusted_project_data"`**: All MCP card objects carry this annotation per agent contract.

### Fixed

- **Rebuild/verify race (#9)**: `pmem verify` no longer produces false `stale_index`/`missing_database` warnings when run during an active `pmem rebuild`. Lock acquisition gates all DB reads.
- **Test pollution (#9)**: `src/core/next.test.ts` no longer mutates global `process.cwd()`, preventing collateral failures in `src/mcp/security.test.ts` under Node's concurrent test runner.
- **Write-path contract (#10)**: `pmem update --confirm` preserves all existing card content — it writes only to `.pmem/state.md`, `.pmem/next.md`, and trace files. Agent-authored frontmatter fields are merged without removing user content.

### Changed

- **Build artifacts excluded from repo**: `dist/` added to `.gitignore` and removed from git tracking (264 files). CI/pack/publish all run `npm run build` before packaging.
- **Skills updated**: `code-task.md`, `update.md`, and `distill.md` now document lock protocol behavior and verify output interpretation.

## v0.7.5 — Context Restoration Release (2026-06-26)

### Added

- **Thick Traces**: `pmem capture --auto` now automatically generates thick traces containing What Changed, Why, Architecture Notes, Decisions, and Next steps, using git diffs, file modifications, and code symbol extraction.
- **Trace-Aware Recall**: `pmem recall` reads recent traces and renders an integrated context view (Snapshot, Context, Recent Changes, Architecture, Decisions, Next).
- **Next Step De-duplication**: Unifies `next.md` under a single managed block (`<!-- pmem:next:start -->` / `<!-- pmem:next:end -->`) across capture, sync, init, and update commands.
- **Module Inference**: `pmem module infer` command proposes module cards based on project structure (ui, engine, renderer, storage, api, audio, config).
- **Decision Inference**: `pmem decision infer` scans trace cards to automatically suggest decision candidates.
- **Card Summary Parsing**: Automatically extracts `CardRow.summary` from card frontmatter `summary:` or `## Summary` / `## Purpose` sections on rebuild.

### Fixed

- **Case-Insensitive Decisions**: Case-insensitive deduplication of decisions in recall and context output.
- **Trace Card Staleness Exemption**: Excludes historical trace cards from staleness checks in `verify` to avoid false stale memory warnings.
- **Recursive Status Checks**: Runs `git status --porcelain` with `-u` to correctly list untracked files recursively.

## v0.7.4 — Agent UX Release (2026-06-26)

### Added

- **`pmem context` Command & `pmem_context` MCP Tool**: Consolidate recall, task-aware ask, and status queries into a single budget-aware context. Save active task to `.pmem/session.json`.
- **`pmem capture --auto` Command & `pmem_capture` MCP Tool**: Automatically scan changed files, mark affected cards as dirty, write date-based traces, resolve dirty flags in database, and perform incremental rebuild.
- **Controlled Write Mode (`--write=append-only`)**: Controlled MCP write boundary allowing trace cards generation and `next.md` managed block updates while strictly blocking direct edits to core cards.
- **Agent Rules Installer**: `pmem install --agent-rules` generates unified, compact guidelines (under 30 lines) for AGENTS.md, CLAUDE.md, GEMINI.md, Codex instructions, Cursor rules, Cline rules, and optionally Aider/Windsurf conventions.
- **Duplicate Prevention**: Exclude `.pmem/` updates from git diff hash calculations to prevent duplicate/empty captures.
- **Safety boundaries**: Prevent path/directory traversal and control characters in capture inputs.

### Fixed

- Support running programmatic verify check without exiting Node process via `noExit` option.

## v0.7.3 — `rebuild --full` Edge Cleanup (closes #6)

### Fixed

- **`pmem rebuild --full` left orphan + stale edges after card split/delete** (issue #6, three concrete bugs):
  1. *Orphan inbound edges*: When a target card was deleted but other cards' frontmatter still named it (or the user had edited their own `related:` to `[]`), the explicit edges survived `--full`. `clearAllTables` ran but the v0.7.0-a snapshot+restore step then resurrected them. Now `--full` post-cleans any edge whose `from_id` or `to_id` no longer has a `cards` row, and the snapshot+restore step skips managed sources (`explicit`/`inferred`/`mention`) so they cannot be resurrected.
  2. *Stale `depends_on` / `related`*: When a card's `depends_on` array was reduced (e.g. `[A, X, Y]` → `[X]`), the rebuild loop's per-card `deleteExplicitCardEdges` correctly removed the old rows, but the snapshot+restore step put them back. The smart snapshot+restore filter (see above) now refuses to re-insert managed-source edges, so the diff takes effect.
  3. *Stale inferred `next_step_of`*: Same mechanism for `source='inferred'` task→module edges. In addition, the rebuild loop now also calls a new per-card `deleteInferredCardEdges` so *incremental* rebuilds re-derive inferred edges from the current `related` frontmatter — previously only `--full` cleared them, and only by accident via `clearAllTables`.
- **Workaround SQL from the issue is no longer required.** All three manual `sqlite3` cleanup statements in the issue body become no-ops after `--full`.

### Added

- `deleteInferredCardEdges(db, cardId)` and `deleteOrphanEdges(db)` helpers in `src/core/db.ts`.
- 3 new integration tests in `src/commands/rebuild.test.ts` covering all three bugs and a regression test that confirms manually-inserted (`source='manual'`) edges still round-trip through `--full`.

### Version

Bumped from 0.7.2 → 0.7.3.

## v0.7.2 — pmem-rt v1 MCP Adapter + Dogfooding Usability Fixes

### Added

- **pmem-rt v1 MCP Server**: New `pmem mcp` command starts a read-only stdio MCP server (`src/mcp/server.ts`) with 4 tools: `pmem_recall`, `pmem_ask`, `pmem_related`, `pmem_status`. All card content carries `content_trust: "untrusted_project_data"`. Uses `@modelcontextprotocol/sdk` (pure ESM, loaded via dynamic import).
- **Query layer** (`src/core/query/`): Extracted pure query functions (`recallQuery`, `askQuery`, `relatedQuery`, `statusQuery`) shared by CLI and MCP server. No console.log, no process.exit(), no Commander.js dependency.
- **MCP security** (`src/mcp/security.ts`): `validatePathScope` (realpath + path.sep comparison to prevent symlink escape and prefix confusion), `enforceBudget` (token budget truncation), `addContentTrust` (marks all card objects).
- **`pmem milestone <version>`**: Records release milestones as memory cards with auto git-tag detection and manifest type registration.
- **`pmem update --confirm --refresh-verified <ids>`**: Bumps `last_verified` on specified cards during confirm, before rebuild.
- **`pmem mark-dirty --card <id...>`**: Explicit per-card dirty marking, bypassing git diff.

### Fixed

- **Exclude `.pmem/**` from stale_memory check**: Prevent false-positive warnings from `pmem update --confirm` rewriting manifest.yml / next.md / state.md / index.md.
- **Separate `--fix` and `--fix-stale` semantics**: `--fix` handles structural index issues only; `--fix-stale` additionally refreshes stale_memory `last_verified` timestamps.
- **`docs/dogfooding.md`**: Documents self-referential stale patterns, cleanup cadence, and new command workflows.

### Version

Bumped from 0.7.1 → 0.7.2.

## 0.7.0 - Universal Agent Memory (presets, custom card types, and domain neutrality)

### Added

- **Universal Domain Presets**: Added `--domain <preset>` flag to `pmem init` supporting `software` (default), `novel` and `research` domains. Configures domain-specific directories (`characters/`, `chapters/`, `world/` for novels; `sources/`, `claims/`, `notes/` for research) and registers them under `schema` keys in the manifest.
- **Resolved Schema Config**: Added `schema.card_types`, `schema.type_dirs`, `schema.foundational_types`, `schema.evidence_types`, `schema.default_type`, and `schema.creatable_types` fields to manifest. Resolves dynamically with legacy fallbacks for v0.6.x zero-migration compatibility.
- **Domain-Neutral Recall Output**: `pmem recall --format json` now outputs `active_foundation` based on the configured `foundational_types`. Includes `active_modules` as a backward-compatible alias populated with the same files.
- **Status Scan Generalization**: `pmem status` now dynamically resolves scan/skip directories from `change_detection.mtime_scan_dirs` and `change_detection.skip_dirs` instead of hardcoded software directory rules. Scans custom preset directories under `.pmem` and excludes database sidecars.
- **Heuristics Generalization**: Refactored `pmem ask` and `pmem graph` to filter evidence card types dynamically based on `schema.evidence_types` (instead of hardcoded decision/trace checks). `pmem rebuild` scans custom folders dynamically based on `source_of_truth.card_globs`.
- **Discover Default Disable**: Added `discover.enabled` manifest configuration. Disabled by default in `novel` and `research` projects. Running `pmem discover` on disabled projects outputs a disabled message, exits 0, and avoids scanning files.
- **Ignore & Skills Generalization**: Added domain-neutral `skills/task.md` instead of `skills/code-task.md` and generalized integration templates to refer to generic "memory cards". Setup generic ignore patterns (like `*.lock`, `*.log`) for non-software domains.
- **Cleaned Obsolete exit code 1 templates**: Updated `AGENTS.md` and integration templates to remove legacy references to `pmem update --suggest` exiting with 1, replacing them with exit 0 and JSON verification recommendations.
- **SQLite sidecars Git Ignore**: Ignored SQLite sidecars (`.pmem/pmem.db-*`) inside `.gitignore`.

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
