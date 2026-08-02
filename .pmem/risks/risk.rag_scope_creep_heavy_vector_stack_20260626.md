---
id: risk.rag_scope_creep_heavy_vector_stack_20260626
type: risk
title: "RAG Scope Creep Into Heavy Vector Stack"
status: active
tags: [risk, rag, vector-db, scope, architecture]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/manifest.yml
depends_on:
  - decision.project_rag_os_positioning_20260626
related_to:
  - decision.sqlite_first_semantic_layer_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v1_1_1_lightweight_semantic_layer_20260626
last_verified: "2026-06-26T12:15:00.000Z"
classification: risk
trust_label: user_confirmed
sensitivity: internal
---
# RAG Scope Creep Into Heavy Vector Stack

## Risk

The Project RAG OS direction could be misread as "attach a vector database" and pull pmem into a heavy document-RAG architecture before the local project-memory path is proven.

## Impact

- Higher install and runtime complexity.
- Harder dogfooding and local-first guarantees.
- Less explainable recall.
- More emphasis on generic document QA than project state restoration.
- Premature dependency choices that become difficult to remove.

## Mitigation

- Make v0.8 deterministic and structure-first.
- Require an architecture decision before semantic search implementation.
- Keep semantic search optional and SQLite-first in v1.1.1.
- Treat heavy vector engines as scale-specific options, not defaults.
