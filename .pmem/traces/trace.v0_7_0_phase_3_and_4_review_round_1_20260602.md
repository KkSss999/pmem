---
id: trace.v0_7_0_phase_3_and_4_review_round_1_20260602
type: trace
title: "v0.7.0 Phase 3 and 4 Review Round 1"
status: active
tags: [v0.7.0, phase-3, phase-4, review, p0]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/commands/init.ts
  - src/commands/recall.ts
  - src/core/discover/index.ts
  - scripts/e2e-v07-novel.sh
  - scripts/e2e-v07-research.sh
depends_on:
  - feature.v0_7_0_universal_agent_memory_20260602
related_to:
  - trace.v0_7_0_phase_2_acceptance_20260602
  - decision.dogfood_pmem_for_pmem_development_20260602
---
# v0.7.0 Phase 3 and 4 Review Round 1

## CTO Conclusion

Phase 3/4 round 1 is not accepted yet.

## Passed Checks

CTO reran:

```bash
npm test
npm run test:e2e:workflow
npm run test:e2e:v061-suggest
npm run test:e2e:v063-discover
npm run test:e2e:v07-novel
npm run test:e2e:v07-research
```

All passed.

Manual smoke confirmed:

- novel `recall --format json` has `active_foundation`
- novel `active_modules` equals `active_foundation`
- novel discover JSON has `enabled: false`
- software discover is not disabled by default

## Remaining P0

`pmem init` still generates integration/root guidance that claims `pmem update --suggest` exits with code 1 when suggestions exist. This is wrong for v0.6.2+ and violates the v0.7.0 compatibility boundary.

Manual repro after fresh init:

```text
AGENTS.md: `pmem update --suggest` exits with code 1 when suggestions exist
.pmem/integrations/codex/AGENTS.md: Treat exit code 1 from suggest commands as action suggested
.pmem/integrations/cursor/rules.example.md: Exit code 1 from `pmem update --suggest` means suggestions exist
.pmem/integrations/claude-code/CLAUDE.md: `pmem update --suggest` exits with code 1 when suggestions exist
```

Correct behavior is v0.6.2+: `pmem update --suggest` exits 0 for successful suggestion output; agents must parse JSON such as `summary.has_actionable`.

## Secondary Hygiene

Dogfooding generated `.pmem/pmem.db-wal` and `.pmem/pmem.db-shm` as untracked files. `.gitignore` should ignore `.pmem/pmem.db-*` or those explicit sidecars.

## Required Rework

- Fix all init-generated templates to describe v0.6.2+ suggestion exit semantics.
- Add a focused test or grep assertion that fresh init output contains no `exit code 1` / `exits with code 1` suggestion guidance.
- Extend `.gitignore` for SQLite sidecar files.
- Re-run the full verification suite.
