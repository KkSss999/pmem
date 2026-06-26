# Project State

## Overall Status: v0.7.5 published; project repositioned toward a structure-first, CRUD-capable Project RAG OS.

## Modules
| Module | Status | Last Updated |
|--------|--------|--------------|
| module.cli_runtime_20260602 | active | 2026-06-03 |
| module.manifest_runtime_20260602 | active | 2026-06-03 |

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
- 2026-06-26: Repositioned pmem from "project logs plus recall" toward "structured project memory + high-quality RAG + agent-CRUD local knowledge OS".
  - v0.7.5 is now treated as the published Context Restoration milestone.
  - v0.8 becomes the Hybrid Recall Engine target: SQLite FTS/BM25, structured filters, graph expansion, recency/module/decision scoring, task-aware context packing, and explainable recall.
  - v0.8.5 adds a lightweight semantic layer only after hybrid recall is working; SQLite-first storage is preferred over a heavy vector database.
  - v0.9 adds contextual retrieval and reranking.
  - v1.0 targets Project RAG OS semantics: remember, forget, supersede, promote, distill, verify, and evidence-traceable CRUD.
- 2026-06-06: Recorded v0.7.5 design discussion as memory cards.
  - Re-scoped visualization from v0.8.0 → v0.7.5 closeout target.
  - Locked the read-only / single-project / localhost scope.
  - Locked Sigma.js + hybrid Markdown (server pre-parses frontmatter + wikilinks, client uses `marked` + `DOMPurify`).
  - Locked wikilink click behavior: switch panel + temporary in/out edge highlight.
  - Explicitly deferred MCP / `pmem-rt` to post-v0.7.5 (not absorbed into v0.7.5).
  - New cards: 1 feature, 4 decisions, 1 trace. Updated 1 task.
  - Superseded on 2026-06-26 by the Project RAG OS roadmap; retained as historical Web UI design material.

## Recent Changes (v0.7.1)
- Updated program version and template versions to `0.7.1`.
- Implemented `pmem sync` shortcut command, `pmem verify --fix-stale` auto-fix option, and flexible token policy checking.
- Updated project README and agent skills documentation to cover v0.7.1 features.
- Verified all unit, integration, and E2E sync-flow tests pass successfully.
