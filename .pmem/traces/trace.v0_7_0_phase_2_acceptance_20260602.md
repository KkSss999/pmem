---
id: trace.v0_7_0_phase_2_acceptance_20260602
type: trace
title: "v0.7.0 Phase 2 Acceptance"
status: completed
tags: [v0.7.0, phase-2, acceptance, domain-presets]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/commands/init.ts
  - src/commands/init.test.ts
  - src/core/manifest.ts
  - src/types.ts
  - scripts/e2e-v07-novel.sh
  - walkthrough.md
depends_on:
  - task.v0_7_0_phase_2_domain_presets_20260602
related_to:
  - trace.v0_7_0_phase_2_review_round_1_20260602
  - trace.v0_7_0_phase_2_review_round_2_20260602
  - decision.v0_7_0_zero_migration_compatibility_20260602
---
# v0.7.0 Phase 2 Acceptance

## CTO Conclusion

Phase 2 Domain Presets accepted after round 3.

## Accepted Scope

- `pmem init --domain <domain>` supports `software`, `novel`, and `research`.
- Default domain is `software`.
- Unknown domains exit 2 and list valid domains.
- Init creates card directories from preset `type_dirs`.
- Init writes `project.domain`.
- Init writes `schema.card_types`, `schema.type_dirs`, `schema.foundational_types`, `schema.evidence_types`, `schema.default_type`, and `schema.creatable_types`.
- `source_of_truth.card_globs` is generated from `type_dirs`.
- `package.json` has `pretest` to build dist before CLI tests.

## Key Compatibility Fix

Explicit `creatable_types` prevents software and preset projects from creating runtime-only or compatibility-only types.

Accepted creatable sets:

- software: decision/module/task/feature/risk/trace
- novel: character/chapter/world/arc/decision/trace
- research: source/claim/note/experiment/decision/trace

## Final P0 Fix

Novel `foundational_types` was corrected to `character/chapter`, matching the approved v0.7.0 pre-design. Manual smoke confirmed generated novel manifest:

```text
domain=novel
foundation=character,chapter
creatable=character,chapter,world,arc,decision,trace
project_exit=2
chapter_exit=0
```

## Verification

CTO reran:

```bash
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
npm run test:e2e:v063-discover
npm run test:e2e:v07-novel
```

Results:

- npm test: 166/166 pass
- workflow E2E passed
- v061 suggest E2E passed, 18/0
- v063 discover E2E passed, 10/0
- v07 novel E2E passed

## Next

Proceed to Phase 3: friction polish, especially `recall` JSON output with `active_modules` compatibility and new `active_foundation` from manifest `foundational_types`.
