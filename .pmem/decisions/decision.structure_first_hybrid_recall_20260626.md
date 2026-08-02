---
id: decision.structure_first_hybrid_recall_20260626
type: decision
title: "Structure-First Hybrid Recall Before Vector RAG"
status: active
tags: [retrieval, hybrid-search, bm25, graph, recall, v0.8]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - src/core/query/recall.ts
  - src/core/query/ask.ts
  - src/core/query/related.ts
depends_on:
  - decision.project_rag_os_positioning_20260626
related_to:
  - feature.v0_8_hybrid_recall_engine_20260626
  - module.recall_retrieval_runtime_20260626
  - task.rag_research_sprint_20260626
last_verified: "2026-08-02T08:44:58.629Z"
classification: decision
trust_label: user_confirmed
sensitivity: internal
---
# Structure-First Hybrid Recall Before Vector RAG

## Decision

v0.8 should build a Hybrid Recall Engine before adding a vector database. The first production-grade retrieval layer should combine SQLite FTS/BM25, exact IDs, card fields, metadata filters, recency, graph expansion, module/decision boosts, task-aware ranking, and context packing.

## Rationale

Project questions often include exact filenames, command output, error text, card IDs, version numbers, module names, and decision titles. BM25 and structured filters are strong for this data. Graph expansion is also native to pmem because cards already encode relationships. Dense embeddings help with vague semantic questions, but they should not replace deterministic structure.

## Required Properties

- Candidate generation should be explainable.
- Ranking should preserve evidence traceability.
- Recall output should say why each card or chunk was included.
- The engine should work with current Markdown cards and SQLite indexes.
- Optional semantic rerank can be added later without changing the card source of truth.
