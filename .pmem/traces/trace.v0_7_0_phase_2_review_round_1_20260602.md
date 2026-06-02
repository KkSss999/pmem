---
id: trace.v0_7_0_phase_2_review_round_1_20260602
type: trace
title: "v0.7.0 Phase 2 Review Round 1"
status: active
tags: [v0.7.0, phase-2, review, p0]
created: "2026-06-02"
source_files:
  - src/commands/init.ts
  - src/core/manifest.ts
  - src/commands/init.test.ts
  - scripts/e2e-v07-novel.sh
depends_on:
  - task.v0_7_0_phase_2_domain_presets_20260602
related_to:
  - decision.v0_7_0_zero_migration_compatibility_20260602
  - module.manifest_runtime_20260602
---
# v0.7.0 Phase 2 Review Round 1

## CTO Conclusion

Phase 2 round 1 is not accepted.

## P0

Default `pmem init` now writes `schema.card_types` for the software preset including `project`, `assumption`, and `resource`. Because `resolveConfig()` treats any manifest with `schema.card_types` as custom and derives `creatable_types = card_types - integration`, new software projects accept:

- `pmem new project`
- `pmem new assumption`
- `pmem new resource`

This reopens the Phase 1 compatibility bug in a new-project path.

Manual repro:

```bash
node dist/index.js init my-soft --guided --description "d" --stage "s" --next "n"
node dist/index.js new project "Smoke project"      # exits 0, writes .pmem/projects/
node dist/index.js new assumption "Smoke assumption" # exits 0, writes .pmem/assumptions/
node dist/index.js new resource "Smoke resource"    # exits 0, writes .pmem/resources/
```

These directories are not in `source_of_truth.card_globs`, so created cards can be outside rebuild coverage.

## Secondary Findings

- The developer report references `walkthrough.md`, but no such file exists in the working tree.
- `init.test.ts` tests that software rejects `character`, but it does not test rejection of `project`, `assumption`, or `resource`.
- `novel` and `research` presets include `project` in `card_types` without a matching `type_dirs` entry, so they likely have the same orphan-directory behavior for `pmem new project`.

## Required Rework

Add an explicit creatability policy for domain presets, or otherwise ensure preset-declared compatibility/runtime-only types are not creatable. Tests must cover default software and non-software presets.
