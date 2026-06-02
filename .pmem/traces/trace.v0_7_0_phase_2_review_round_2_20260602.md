---
id: trace.v0_7_0_phase_2_review_round_2_20260602
type: trace
title: "v0.7.0 Phase 2 Review Round 2"
status: active
tags: [v0.7.0, phase-2, review, p0]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/commands/init.ts
  - src/commands/init.test.ts
  - docs/v0.7.0 pre-design.md
depends_on:
  - task.v0_7_0_phase_2_domain_presets_20260602
related_to:
  - trace.v0_7_0_phase_2_review_round_1_20260602
  - decision.v0_7_0_zero_migration_compatibility_20260602
---
# v0.7.0 Phase 2 Review Round 2

## CTO Conclusion

Phase 2 round 2 is not accepted yet.

## Fixed Since Round 1

The P0 creatable type pollution was fixed:

- software `creatable_types`: decision/module/task/feature/risk/trace
- novel `creatable_types`: character/chapter/world/arc/decision/trace
- research `creatable_types`: source/claim/note/experiment/decision/trace
- default software now rejects project/assumption/resource/integration/character
- novel and research now reject project

Manual smoke confirmed these boundaries.

## Remaining P0

`novel` preset writes `schema.foundational_types: [character, world]`, but the approved v0.7.0 pre-design specifies `character/chapter` for novel foundational types.

This matters because Phase 3 recall will read `schema.foundational_types` to produce `active_foundation`. If Phase 2 writes the wrong foundation, Phase 3 will implement correct logic over incorrect data.

## Required Rework

- Change novel preset foundational types to `['character', 'chapter']`.
- Update `init.test.ts` to assert `['character', 'chapter']`, not `['character', 'world']`.
- Add or adjust E2E validation if it checks foundational types.
- Re-run build, unit/CLI tests, workflow E2E, suggest E2E, discover E2E, and v07 novel E2E.

## Verification Already Run

CTO reran:

```bash
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
npm run test:e2e:v063-discover
npm run test:e2e:v07-novel
```

All passed before this finding.
