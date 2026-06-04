---
id: trace.v0_7_0_phase_3_and_4_acceptance_20260602
type: trace
title: "v0.7.0 Phase 3 and 4 Acceptance"
status: completed
tags: [v0.7.0, phase-3, phase-4, acceptance, finalization]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/commands/recall.ts
  - src/commands/status.ts
  - src/commands/rebuild.ts
  - src/core/discover/index.ts
  - src/commands/init.ts
  - scripts/e2e-v07-novel.sh
  - scripts/e2e-v07-research.sh
depends_on:
  - feature.v0_7_0_universal_agent_memory_20260602
related_to:
  - trace.v0_7_0_phase_3_and_4_review_round_1_20260602
  - trace.v0_7_0_phase_2_acceptance_20260602
last_verified: "2026-06-04T22:03:36.792Z"
---
# v0.7.0 Phase 3 and 4 Acceptance

## CTO Conclusion

Phase 3 and Phase 4 accepted after rework. v0.7.0 development goals are complete.

## Accepted Scope

- `recall --format json` now returns both `active_foundation` and compatibility alias `active_modules`.
- Foundation cards are selected from resolved manifest `foundational_types`.
- Novel and research E2E validate domain foundation recall.
- `discover.enabled` defaults true for software and false for novel/research.
- `pmem discover` exits 0 with disabled output for disabled domains.
- `rebuild` scans manifest card globs / domain card directories.
- `status` and related scanning logic are more domain-aware.
- Generated skills/integration prompts are more domain-neutral.
- Init-generated templates now describe v0.6.2+ `update --suggest` semantics correctly: exits 0, parse JSON such as `summary.has_actionable`.
- `.gitignore` ignores SQLite sidecars with `.pmem/pmem.db-*`.

## Verification

CTO reran:

```bash
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
npm run test:e2e:v063-discover
npm run test:e2e:v07-novel
npm run test:e2e:v07-research
```

Results:

- unit/CLI tests: 167/167 pass
- workflow E2E passed
- v061 suggest E2E passed, 18/0
- v063 discover E2E passed, 10/0
- v07 novel E2E passed
- v07 research E2E passed

## Manual Smoke

Fresh init output no longer contains:

- `exit code 1`
- `exits with code 1`
- `exits 1`

Fresh init output does contain exit 0 / JSON parse guidance in:

- root `AGENTS.md`
- `.pmem/integrations/codex/AGENTS.md`
- `.pmem/integrations/claude-code/CLAUDE.md`
- `.pmem/integrations/cursor/rules.example.md`

## Next

Move to v0.7.0 release readiness: review changelog, roadmap, package version, npm publish status, and final git hygiene.
