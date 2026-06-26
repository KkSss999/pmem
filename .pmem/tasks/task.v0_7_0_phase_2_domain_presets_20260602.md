---
id: task.v0_7_0_phase_2_domain_presets_20260602
type: task
title: "v0.7.0 Phase 2 Domain Presets"
status: completed
tags: [v0.7.0, phase-2, init, domain-presets]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/commands/init.ts
  - src/commands/init.test.ts
  - src/index.ts
  - src/types.ts
  - scripts/e2e-v07-novel.sh
  - docs/v0.7.0 pre-design.md
depends_on:
  - feature.v0_7_0_universal_agent_memory_20260602
  - decision.v0_7_0_zero_migration_compatibility_20260602
related_to:
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
last_verified: "2026-06-26T11:35:51.960Z"
---
# v0.7.0 Phase 2 Domain Presets

## Goal

Implement `pmem init --domain` so new projects can start from built-in domain presets instead of manually editing manifest schema fields.

## CTO Plan

Phase 2 should implement only the P0 domain preset layer:

- Add `--domain <domain>` flag to init, defaulting to `software`.
- Add `DOMAIN_PRESETS` for `software`, `novel`, and `research`.
- Create `.pmem` card directories from preset `type_dirs`.
- Generate `source_of_truth.card_globs` from preset `type_dirs`.
- Write `project.domain`.
- Write `schema.card_types`, `schema.type_dirs`, `schema.foundational_types`, `schema.evidence_types`, and `schema.default_type`.
- Keep old behavior: no `--domain` remains software; v0.6 workflow does not regress; no migration.

## Out Of Scope

- Do not change `recall`, `status`, `discover`, `ask`, or `graph` in Phase 2 unless required for tests.
- Do not implement interactive custom type preset wizard.
- Do not expand beyond the three built-in domains.

## Required Tests

- Default `pmem init` remains software-compatible.
- `init --domain novel` creates `characters`, `chapters`, `world`, `arc`, `decisions`, and `traces`.
- Novel manifest contains correct schema fields.
- Novel `pmem new character "张三"` writes to `characters/`.
- Software `pmem new character "张三"` is rejected.
- `init --domain research` creates `sources`, `claims`, `notes`, `experiments`, `decisions`, and `traces`.
- Unknown domain exits 2 and lists valid domains.

## Required Verification

```bash
npm run build
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
```

Add `scripts/e2e-v07-novel.sh` if feasible in this phase.

## Current State

When dogfooding memory was initialized, the working tree already had uncommitted Phase 2 files:

- `src/commands/init.ts`
- `src/commands/init.test.ts`
- `scripts/e2e-v07-novel.sh`
- `src/index.ts`
- `src/types.ts`
- generated `dist` files
- `package.json`

Accepted after Phase 2 Review Round 3. See `trace.v0_7_0_phase_2_acceptance_20260602`.
