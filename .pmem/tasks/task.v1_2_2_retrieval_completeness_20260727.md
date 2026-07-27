---
id: task.v1_2_2_retrieval_completeness_20260727
type: task
title: "v1.2.2 retrieval completeness and content"
status: active
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, issue-30, issue-31, issue-32, ask, recall, creative]
created: "2026-07-27"
source_files:
  - src/commands/ask.ts
  - src/commands/recall.ts
  - src/core/query/ask.ts
  - src/core/query/recall.ts
  - src/core/query/engine/intent.ts
  - src/core/query/engine/pack.ts
depends_on:
  - task.v1_2_2_post_release_reliability_20260727
---
# v1.2.2 retrieval completeness and content

## Scope

- #30: recognize inventory intent and return a complete type-scoped set with total count and completeness metadata; expose an explicit list path if needed.
- #31: return evidence-backed excerpts or packed answer context, not only card locations.
- #32: make `recall` allocate budget to foundational character, chapter, world, source, and claim content according to the active schema.

## Acceptance

- Novel fixture returns all four characters for Chinese and English inventory queries, with no unrelated card types in the inventory result.
- Chapter questions return the relevant chapter content needed to answer the question while preserving source attribution.
- Recall includes bounded foundational summaries and recent continuity without dropping mandatory project/stage/next context.
- Compact, JSON, CLI, SDK, and MCP contracts remain consistent and budget bounded.
