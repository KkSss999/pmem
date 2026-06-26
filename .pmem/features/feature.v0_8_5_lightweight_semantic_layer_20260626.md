---
id: feature.v0_8_5_lightweight_semantic_layer_20260626
type: feature
title: "v0.8.5 Lightweight Semantic Layer"
status: draft
tags: [v0.8.5, semantic-search, embeddings, sqlite, retrieval]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/manifest.yml
depends_on:
  - feature.v0_8_hybrid_recall_engine_20260626
  - decision.sqlite_first_semantic_layer_20260626
related_to:
  - feature.v0_9_contextual_rerank_retrieval_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:15:00.000Z"
---
# v0.8.5 Lightweight Semantic Layer

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
