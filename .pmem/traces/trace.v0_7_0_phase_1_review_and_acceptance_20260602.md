---
id: trace.v0_7_0_phase_1_review_and_acceptance_20260602
type: trace
title: "v0.7.0 Phase 1 Review and Acceptance"
status: completed
tags: [v0.7.0, phase-1, review, acceptance]
created: "2026-06-02"
source_files:
  - src/commands/new.ts
  - src/core/manifest.ts
  - src/core/manifest.test.ts
  - src/commands/new.test.ts
  - package.json
depends_on:
  - feature.v0_7_0_universal_agent_memory_20260602
related_to:
  - decision.v0_7_0_zero_migration_compatibility_20260602
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
---
# v0.7.0 Phase 1 Review and Acceptance

## Summary

Phase 1 was accepted after three rounds of CTO review and two focused返工 rounds.

## Baseline

- `main` was sealed as v0.6.4.
- v0.7.0 pre-design was approved at commit `3f8bf11`.
- Initial Phase 1 implementation was commit `468fdb0`.

## Rejections

Round 2 rejected Phase 1 because `pmem new` used `card_types` directly, which widened old-project creatable types. Old projects would incorrectly accept `project`, `assumption`, and `resource`; only `integration` had been blocked.

Round 3 found the implementation fixed, but tests still only covered `resolveConfig` pure behavior, not the `newCommand`/CLI behavior requested by CTO.

## Acceptance

Phase 1 was accepted at:

- `89b2b75 v0.7.0 Phase 1 (revised 3): CLI-focused tests for pmem new`

Accepted coverage:

- Old project rejects `project`, `assumption`, `resource`, `integration`.
- Old project accepts `module`.
- Custom schema accepts `character` and writes to `characters/`.
- `package.json` includes `src/commands/*.test.ts` in `npm test`.

## Verification

CTO reran:

```bash
npm run build
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
```

Results:

- build passed
- tests passed, 162/162
- workflow E2E passed
- v061 suggest E2E passed, 18/0

## Date Note

CLI-generated card IDs used UTC date `20260602`; the user environment timezone was Asia/Shanghai on 2026-06-03.
