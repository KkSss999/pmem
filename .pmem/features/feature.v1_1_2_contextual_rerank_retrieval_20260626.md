---
id: feature.v1_1_2_contextual_rerank_retrieval_20260626
type: feature
title: "v1.1.2 Contextual Retrieval and Reranking"
status: superseded
tags: [v1.1.2, contextual-retrieval, reranking, evidence, recall]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
superseded_by: task.v1_2_0_unified_release_20260724
source_files:
  - src/core/query/recall.ts
  - src/core/query/ask.ts
depends_on:
  - feature.v0_8_hybrid_recall_engine_20260626
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - feature.v1_0_project_rag_os_20260626
  - module.recall_retrieval_runtime_20260626
last_verified: "2026-08-03T06:00:02.274Z"
classification: plan
trust_label: user_confirmed
sensitivity: internal
---
# v1.1.2 Contextual Retrieval and Reranking

> Release disposition: this draft is absorbed into the single v1.2.0 acceptance unit. No standalone v1.1.2 release will be produced.

## Goal

Make recall results more accurate by adding context-aware chunking and a second-stage rerank step after deterministic candidate generation.

## Scope

- Contextual chunks that include card type, project/module/decision context, trace origin, source files, symbols, and freshness.
- Query rewrite for task-specific retrieval.
- Small-to-big retrieval: find precise chunks, then pack their parent cards and adjacent evidence.
- Candidate reranking over 50-200 candidates down to a 5-20 item context pack.
- Citation and evidence scoring so recalled context can be traced back to cards and source files.

## Principle

Reranking improves final ordering; it should not hide source evidence or make memory writes automatic. pmem remains confirmation-first for memory changes.
