---
id: trace.project_rag_os_repositioning_20260626
type: trace
title: "Project Repositioning Toward Project RAG OS"
status: completed
tags: [positioning, rag, roadmap, project-rag-os]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/state.md
  - .pmem/next.md
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - decision.structure_first_hybrid_recall_20260626
  - decision.sqlite_first_semantic_layer_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v1_0_project_rag_os_20260626
last_verified: "2026-06-26T12:19:26.214Z"
---
# Project Repositioning Toward Project RAG OS

## Summary

The project was repositioned around a new end state: pmem should be structured project memory plus high-quality RAG plus an agent-CRUD local knowledge OS.

## Key Outcomes

- v0.7.5 is treated as the published Context Restoration milestone.
- v0.8 is now the Hybrid Recall Engine target.
- v0.8.5 adds a lightweight semantic layer after deterministic recall is proven.
- v0.9 adds contextual retrieval and reranking.
- v1.0 targets Project RAG OS semantics with explicit remember, forget, supersede, promote, distill, search, context, doctor, and verify workflows.

## Important Constraint

pmem should avoid becoming a traditional document-RAG stack. The core domain is project state: cards, traces, modules, decisions, next steps, source files, symbols, git diffs, graph edges, and evidence-backed agent actions.
