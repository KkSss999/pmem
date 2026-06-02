# Phase 3 & 4 Completion Walkthrough (v0.7.0 Finalization)

This walkthrough documents the successful implementation of Phase 3 (Friction Polish) and Phase 4 (Discover Default Disable) for `pmem` v0.7.0. The code supports software, novel, and research domains in a domain-neutral manner while keeping backward compatibility with v0.6.x legacy projects fully intact.

## Changes Made

### 1. Types & Config Definitions
- Added `discover?: { enabled: boolean }` optional configuration to `ManifestV03` in [types.ts](file:///Users/kerye/Codings/pmem/src/types.ts#L425).

### 2. Phase 3: Recall Domain-Neutral Output
- Refactored `recallCommand` in [recall.ts](file:///Users/kerye/Codings/pmem/src/commands/recall.ts) to filter active cards against resolved manifest `foundational_types`.
- Added the `active_foundation` field to the JSON output containing the file paths of foundational cards.
- Kept the `active_modules` field (with the exact same content as `active_foundation`) for backward compatibility with existing agent parser schemas.
- Non-schema/legacy projects default `foundational_types` to `['module']`, maintaining legacy behavior.

### 3. Phase 3: Status Scan Directory Generalization
- Modified `getChangedFiles` in [status.ts](file:///Users/kerye/Codings/pmem/src/commands/status.ts#L221) to dynamically read user skip directories from `change_detection.skip_dirs` and merge them with system skips.
- Excluded `.pmem/pmem.db`, `.pmem/indexes`, `.pmem/.lock`, and other internal runtime files from triggering file change warnings.
- Modified the mtime scanner to scan directories dynamically from `change_detection.mtime_scan_dirs` or resolved preset `type_dirs` under `.pmem`, preventing hardcoding to software directories only.

### 4. Phase 3: Ask & Graph Heuristics Generalization
- Updated evidence file queries in [ask.ts](file:///Users/kerye/Codings/pmem/src/commands/ask.ts) and [graph.ts](file:///Users/kerye/Codings/pmem/src/commands/graph.ts) to filter using resolved `config.evidence_types` dynamically instead of hardcoding `decision` or `trace` path patterns.

### 5. Phase 3: Rebuild Card Globs Coverage
- Updated `cardFiles` collection in [rebuild.ts](file:///Users/kerye/Codings/pmem/src/commands/rebuild.ts#L64) to scan directories dynamically based on `manifest.source_of_truth.card_globs` if defined, instead of scanning the entire `.pmem/` recursively. Legacy projects fall back to the recursive `.pmem/` scanner.
- Added `collectMdFiles` helper function to handle directory walking recursively.

### 6. Phase 3: Ignores & Skills Generalization
- Updated default `auto_update.ignore_patterns` during project initialization in [init.ts](file:///Users/kerye/Codings/pmem/src/commands/init.ts) to be domain-neutral: software projects retain `node_modules/**`, `dist/**` etc., while non-software projects get generic skips (`*.lock', '*.log`).
- Generalized `CODE_TASK_SKILL` -> `TASK_SKILL` with domain-neutral required reads (e.g. foundational/decision cards instead of modules).
- Generated `skills/task.md` instead of `skills/code-task.md` under `.pmem`.
- Replaced software-only terms with "memory card" in integration templates (`CLAUDE.md`, `rules.example.md`, `AGENTS_MD`).

### 7. Phase 4: Discover Default Disable
- Configured presets in [init.ts](file:///Users/kerye/Codings/pmem/src/commands/init.ts) to set `discover.enabled`: `true` for software, and `false` for novel and research.
- Added early exit logic to `discoverCommand` in [discover/index.ts](file:///Users/kerye/Codings/pmem/src/core/discover/index.ts#L61) checking the resolved `discover.enabled` state. Disabled projects print a message (or JSON format equivalent) and exit 0 without executing code scans.

### 8. Testing & E2E Validation
- Expanded [e2e-v07-novel.sh](file:///Users/kerye/Codings/pmem/scripts/e2e-v07-novel.sh) to verify `ask` results, `recall` JSON fields (`active_modules` and `active_foundation`), and `discover` disabled outcomes.
- Created [e2e-v07-research.sh](file:///Users/kerye/Codings/pmem/scripts/e2e-v07-research.sh) checking the initialization, card creation (`source` / `claim`), ask lookup, recall JSON contents, and discover disabled outcomes for the research domain.
- Exposed research E2E target as `test:e2e:v07-research` script in `package.json`.

### 9. Review Round 1 Rework
- Updated `AGENTS.md`, `.pmem/integrations/claude-code/CLAUDE.md`, `.pmem/integrations/cursor/rules.example.md`, and `.pmem/integrations/codex/AGENTS.md` templates in [init.ts](file:///Users/kerye/Codings/pmem/src/commands/init.ts) to correct instructions on `pmem update --suggest`: documented that it exits 0 and agents should parse `summary.has_actionable`.
- Added a focused unit test in [init.test.ts](file:///Users/kerye/Codings/pmem/src/commands/init.test.ts) to ensure that fresh init outputs never contain legacy `exit 1` semantics and always specify `exits 0`.
- Ignored SQLite sidecars (`.pmem/pmem.db-*`) in [.gitignore](file:///Users/kerye/Codings/pmem/.gitignore).

---

## Validation Results

All E2E and unit test suites are fully passing.

### 1. Unit & CLI Tests (`npm test`)
```
ℹ tests 167
ℹ suites 34
ℹ pass 167
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2756.581416
```

### 2. E2E Suites
- Workflow E2E: `npm run test:e2e:workflow` -> **PASS**
- Suggest E2E: `npm run test:e2e:v061-suggest` -> **PASS**
- Discovery E2E: `npm run test:e2e:v063-discover` -> **PASS**
- Novel Preset E2E: `npm run test:e2e:v07-novel` -> **PASS**
- Research Preset E2E: `npm run test:e2e:v07-research` -> **PASS**
