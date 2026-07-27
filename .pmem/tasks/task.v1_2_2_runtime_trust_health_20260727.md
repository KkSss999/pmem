---
id: task.v1_2_2_runtime_trust_health_20260727
type: task
title: "v1.2.2 runtime, trust, and health fixes"
status: active
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, issue-37, issue-38, issue-39, issue-40, trust, health, runtime]
created: "2026-07-27"
source_files:
  - src/index.ts
  - src/commands/new.ts
  - src/commands/rebuild.ts
  - src/commands/semantic.ts
  - src/commands/verify.ts
  - src/core/health/migration.ts
  - src/core/consistency.ts
depends_on:
  - task.v1_2_2_post_release_reliability_20260727
---
# v1.2.2 runtime, trust, and health fixes

## Scope

- #40: discover the project root by walking upward; descendant commands use one root, while real lock contention remains accurately diagnosed.
- #37: every `untrusted_memory` remediation must name an operation that can write the required metadata.
- #38: define explicit `pmem new` trust semantics and make zero-eligible semantic enablement actionable rather than successful-looking.
- #39: measure card content independently from pmem-managed bookkeeping, with migration impact tests at token boundaries.

## Acceptance

- Tests cover project root, `.pmem/`, nested directories, no project, active lock, and stale lock.
- Tests cover newly created cards, existing unlabeled cards, explicit migration, semantic exclusions, compact/JSON parity, and exit codes.
- Health migration cannot reduce a score solely because it added required metadata.
- Existing cards are not silently promoted to trusted.
