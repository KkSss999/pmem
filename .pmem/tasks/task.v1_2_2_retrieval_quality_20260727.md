---
id: task.v1_2_2_retrieval_quality_20260727
type: task
title: "v1.2.2 retrieval ranking quality"
status: active
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, issue-33, issue-36, ranking, semantic, graph, evaluation]
created: "2026-07-27"
source_files:
  - src/core/query/ask.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/intent.ts
  - src/core/query/engine/queryPlan.ts
  - src/core/query/engine/rerank.ts
  - src/core/query/engine/scoring.ts
depends_on:
  - task.v1_2_2_post_release_reliability_20260727
---
# v1.2.2 retrieval ranking quality

## Scope

- #33: prevent small-corpus semantic score collapse from producing nearly identical broad result lists; deterministic intent, fields, graph evidence, and diversity remain authoritative.
- #36: factual relationship questions rank direct event evidence and linked entities above generic cards.

## Acceptance

- Commit Chinese and English benchmark queries with relevance judgments and hard negatives.
- Track top-k precision, factual-hit rank, irrelevant-result rate, and cross-query overlap.
- “谁击败了卡尔” ranks the duel evidence in the accepted top tier and exposes the answer-bearing excerpt.
- Distinct academy, exam, and recursive-magic queries produce materially distinct top results.
- Semantic-off fallback and trust-excluded behavior remain deterministic and useful.
