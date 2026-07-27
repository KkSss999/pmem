---
id: task.v1_2_2_post_release_reliability_20260727
type: task
title: "v1.2.2 close all post-release issues"
status: active
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, release, github-issues, reliability, retrieval, semantic, trust]
created: "2026-07-27"
source_files:
  - package.json
  - packages/semantic-runtime/package.json
depends_on:
  - task.v1_2_1_deep_usage_reliability_20260724
related_to:
  - task.v1_2_2_runtime_trust_health_20260727
  - task.v1_2_2_retrieval_completeness_20260727
  - task.v1_2_2_retrieval_quality_20260727
  - task.v1_2_2_domain_provenance_20260727
---
# v1.2.2 close all post-release issues

## Release Goal

Ship one complete v1.2.2 release that resolves every open Issue #30–#40. No issue moves to v1.3 and no unresolved investigation is omitted from the release gate.

## Workstreams

1. Runtime, trust, and health: #37–#40.
2. Retrieval completeness and content: #30–#32.
3. Retrieval ranking quality: #33 and #36.
4. Domain policy and provenance: #34 and #35.

## Integration Order

- Land the repository-local CLI guard first.
- Implement workstreams as isolated PR-sized changes with regression tests.
- Re-run the shared creative corpus and issue-reproduction suite after every workstream.
- Merge only when all workstreams pass the release gate together.

## Release Gate

- Every Issue #30–#40 has a reproducible fixture, explicit acceptance result, regression coverage, and closure note.
- Both `pmem-ai` and `pmem-ai-semantic` move together to 1.2.2.
- Full unit, E2E, semantic-live, package-install, and npm dry-run checks pass.
- Markdown remains canonical; trust is never silently elevated; semantic retrieval remains optional.
- README, packaged skill, changelog, pmem task status, GitHub issues, npm packages, tag, and GitHub Release agree on 1.2.2.
