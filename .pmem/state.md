# Project State

## Overall Status: v0.7.5 published; project repositioned toward a structure-first, CRUD-capable Project RAG OS.

## Modules

| Module | Status | Last Updated |
|--------|--------|--------------|
| cli_runtime_20260602 | active | 2026-06-02 |
| manifest_runtime_20260602 | active | 2026-06-02 |
| recall_retrieval_runtime_20260626 | active | 2026-07-03 |
## Active Tasks
- task.v0_7_0_phase_2_domain_presets_20260602
- task.post_v0_7_optimization_roadmap_20260602 (updated toward v0.8+ Project RAG OS roadmap)
- task.rag_research_sprint_20260626

## Active Features (roadmap)
- feature.v0_8_hybrid_recall_engine_20260626
- feature.v0_8_5_lightweight_semantic_layer_20260626
- feature.v0_9_contextual_rerank_retrieval_20260626
- feature.v1_0_project_rag_os_20260626

## Recent Changes

- 2026-07-23: v1.0.1 Agent-Trust Operations: added confidence/superseded_by/classification fields to CardFrontmatter, enhanced pmem verify with 5 new checks (low_confidence, unclassified_card, superseded_reference, stale_next_step, conflicting_classifications), scoring pipeline applies confidence boost/penalty and superseded penalty, structured next.md with P0/P1/P2/@owner/criteria, context command displays sorted task queue. 310/310 tests passing.
- 2026-07-22: PR #15 merged: v1.0 Agentic Memory Runtime released to main. Post-merge review fixes applied — SDK type exports, MCP tool schema hardening (additionalProperties: false, path scope validation), CLI forget routed through Runtime, error handling in status/context commands. 310/310 tests passing, E2E green, CI green.
- 2026-06-26: Repositioned pmem from "project logs plus recall" toward "structured project memory + high-quality RAG + agent-CRUD local knowledge OS".
- v0.7.5 is now treated as the published Context Restoration milestone.
- v0.8 becomes the Hybrid Recall Engine target: SQLite FTS/BM25, structured filters, graph expansion, recency/module/decision scoring, task-aware context packing, and explainable recall.
- v0.8.5 adds a lightweight semantic layer only after hybrid recall is working; SQLite-first storage is preferred over a heavy vector database.
- v0.9 adds contextual retrieval and reranking.
- v1.0 targets Project RAG OS semantics: remember, forget, supersede, promote, distill, verify, and evidence-traceable CRUD.
- 2026-06-06: Recorded v0.7.5 design discussion as memory cards.
- Re-scoped visualization from v0.8.0 → v0.7.5 closeout target.
## Recent Changes (v0.7.1)
