---
id: feature.v1_1_1_lightweight_semantic_layer_20260626
type: feature
title: "v1.1.1 Lightweight Semantic Layer"
status: planned
tags: [v1.1.1, macos, semantic-search, embeddings, sqlite, retrieval, graph-retrieval]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/manifest.yml
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
depends_on:
  - feature.v0_8_hybrid_recall_engine_20260626
  - decision.sqlite_first_semantic_layer_20260626
related_to:
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:15:00.000Z"
---
# v1.1.1 Lightweight Semantic Layer

## Goal

Add fuzzy semantic retrieval without turning pmem into a heavy vector database product.

## Scope

- Optional semantic chunks derived from cards, traces, modules, decisions, and source-symbol summaries.
- Local or pluggable embedding generation, with a small default model only if install/runtime cost stays acceptable.
- SQLite-backed embedding storage.
- Linear cosine scan as the first implementation for single-project scale.
- Fusion with v0.8 deterministic candidates rather than replacement of BM25/graph recall.

## Out of Scope

- Mandatory cloud embedding providers.
- Mandatory Qdrant, Milvus, Vespa, turbovec, or sqlite-vec dependency.
- Semantic write decisions without explicit evidence.

## Locked v1.1.1 Profile

- macOS is the required platform under the post-v1.1.0 platform policy; cross-platform support requires a separate decision.
- The user explicitly approves a visible first-time local download of `multilingual-e5-small`.
- Cards split by Markdown headings; vectors find candidates, while existing graph structure and deterministic scoring assemble the final result.
- Other operating systems, contextual reranking, and any daemon/runtime work are deferred.
