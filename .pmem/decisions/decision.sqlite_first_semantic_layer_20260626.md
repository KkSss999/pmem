---
id: decision.sqlite_first_semantic_layer_20260626
type: decision
title: "SQLite-First Semantic Layer"
status: active
tags: [semantic-search, embeddings, sqlite, v1.1.1, architecture]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/manifest.yml
depends_on:
  - decision.structure_first_hybrid_recall_20260626
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:15:00.000Z"
---
# SQLite-First Semantic Layer

## Decision

When pmem adds semantic search, start with a lightweight, optional, SQLite-first layer instead of adopting a heavy vector database by default.

## Preferred Shape

- local embedding generation can use a small model such as MiniLM through a lightweight JavaScript runtime if feasible;
- embeddings can be stored in SQLite as BLOB data;
- single-project scale can initially use linear cosine scan over a few thousand semantic chunks;
- Qdrant, Milvus, Vespa, turbovec, or sqlite-vec remain future options only when scale or performance evidence justifies them.

## Rationale

pmem's default unit is a single local project. The product should stay easy to install, inspect, and dogfood. A heavy vector stack would add operational cost before the project proves that deterministic hybrid recall is insufficient.
