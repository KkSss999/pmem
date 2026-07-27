---
id: task.v1_2_2_domain_provenance_20260727
type: task
title: "v1.2.2 domain policy and generated-content provenance"
status: active
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, issue-34, issue-35, novel, provenance, relations, sync]
created: "2026-07-27"
source_files:
  - src/core/domainPresets.ts
  - src/core/manifest.ts
  - src/commands/sync.ts
  - src/commands/update.ts
  - src/core/capture.ts
depends_on:
  - task.v1_2_2_post_release_reliability_20260727
---
# v1.2.2 domain policy and generated-content provenance

## Scope

- #34: ship novel-specific relation thresholds for characters, chapters, and world cards while preserving user overrides and existing manifests.
- #35: reproduce the reported scaffold creation across CLI sync, capture, integrations, and agent workflows; identify the exact writer and make generated content attributable and reviewable.

## Acceptance

- Dense but valid novel graphs do not produce software-coupling noise under a new novel preset.
- Existing projects are unchanged unless they explicitly adopt new defaults.
- Any pmem-generated card records trust/provenance and the command reports its source trigger and created files.
- If the writer is outside pmem core, the issue closes only with a deterministic external reproduction, ownership evidence, and a concrete integration fix or guard.
- No unexplained card creation remains in the validated workflows.
