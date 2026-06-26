---
id: task.rag_research_sprint_20260626
type: task
title: "RAG Research Sprint for v0.8 Architecture"
status: active
tags: [research, rag, v0.8, architecture, retrieval, evaluation]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/next.md
depends_on:
  - decision.project_rag_os_positioning_20260626
  - decision.structure_first_hybrid_recall_20260626
related_to:
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v0_8_5_lightweight_semantic_layer_20260626
  - feature.v0_9_contextual_rerank_retrieval_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:19:26.214Z"
---
# RAG Research Sprint for v0.8 Architecture

## Goal

Produce a concrete `pmem v0.8 Hybrid Recall Engine` architecture decision before implementation begins.

## Research Questions

- Hybrid search: how should BM25/FTS, dense candidates, and fusion eventually combine?
- Reranking: which rerank stages are useful, and which belong in v0.9 rather than v0.8?
- Contextual retrieval: how should trace/module/decision/symbol chunks carry project context?
- Project graph retrieval: how should module, decision, trace, task, source file, and symbol edges expand candidates?
- Chunking: what are the units for cards, traces, source files, and symbols?
- CRUD memory lifecycle: how should stale, superseded, deleted, archived, and promoted memory behave?
- Evaluation: what query set proves recall improved?
- Storage: when are SQLite-only, sqlite-vec, turbovec, Qdrant, Milvus, or Vespa appropriate?

## Deliverable

A decision card that locks the v0.8 architecture, implementation phases, evaluation cases, and explicit deferrals.
