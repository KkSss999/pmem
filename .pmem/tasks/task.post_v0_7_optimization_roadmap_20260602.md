---
id: task.post_v0_7_optimization_roadmap_20260602
type: task
title: "Post v0.7 Project RAG OS Roadmap"
status: active
tags: [roadmap, optimization, recall, rag, project-rag-os, retrieval]
created: "2026-06-02"
updated: "2026-06-26T12:15:00.000Z"
token_policy: relaxed
source_files:
  - README.md
  - docs/project-roadmap.md
  - skills/pmem/SKILL.md
depends_on: []
related_to:
  - feature.v0_7_0_universal_agent_memory_20260602
  - feature.v0_7_5_graph_visualization_20260606
  - decision.v0_7_5_scope_read_only_single_project_localhost_20260606
  - decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
  - decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
  - decision.project_rag_os_positioning_20260626
  - decision.structure_first_hybrid_recall_20260626
  - decision.sqlite_first_semantic_layer_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v0_8_5_lightweight_semantic_layer_20260626
  - feature.v0_9_contextual_rerank_retrieval_20260626
  - feature.v1_0_project_rag_os_20260626
  - task.rag_research_sprint_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
  - module.recall_retrieval_runtime_20260626
last_verified: "2026-07-03T00:00:00.000Z"
---
# Post v0.7 Project RAG OS Roadmap

## Context

v0.7.0 turned pmem into universal agent memory for software, novel, research, and custom-schema projects. v0.7.5 has now shipped the Context Restoration line: thick traces, trace-aware recall, module/decision inference, next-step deduplication, and improved project-context restoration.

The next product question is larger than optimization: pmem should become structured project memory plus high-quality RAG plus an agent-CRUD local knowledge OS. It should not collapse into either a project log or a vector database. The durable target is a structure-first, semantic-enhanced, evidence-traceable Project RAG OS.

## Optimization Themes

### 1. Token Economy

Highest priority. Keep `recall` budget-controlled, but make output layered:

- Level 0: project one-liner, stage, focus, next step.
- Level 1: summarized `active_foundation` cards.
- Level 2: relevant card summaries for the current query or task.
- Level 3: paths to full cards for on-demand reading.

- `pmem recall --mode brief|normal|deep`.
- `summary` / `compressed_summary` per card.
- `ask` summaries first; raw body only on request.
- Better trace distillation.
- Domain summaries: chapter summaries for novels, source summaries for research.

### 2. Speed

Large `.pmem` projects need better incremental behavior.

- More precise rebuild invalidation based on file hashes and manifest `card_globs`.
- Smarter `status` mtime scanning with fewer full-directory walks.
- Query-result cache keyed by query plus DB/content hash.
- Graph expansion limits that prevent large projects from flooding recall.
- Lazy, domain-aware discover providers.

### 3. Intelligence

Keep intelligence confirmation-first. Avoid hidden automatic memory rewrites.

- `pmem suggest-card` to recommend new card types for changed files or gaps.
- Stronger `update --apply-suggestion` with explicit confirmation.
- Intent-aware `ask` for decisions, risks, characters, claims, evidence, or tasks.
- Domain checks: novel consistency, research claim/source coverage, software changes without matching memory.

### 4. Human Visualization

The next major product surface can be a local UI for humans to inspect project memory.

- `pmem graph-ui` or `pmem serve` local web interface.
- Card list with type/status/tag filters.
- Relationship graph for `depends_on`, `related_to`, source files, and inferred edges.
- Dirty/stale card dashboard.
- Recall preview by budget/mode and Markdown card detail view.
- Buttons for `rebuild`, `verify`, `distill --suggest`, and edge review.

## Updated Version Path

- v0.7.5: **Context Restoration**. The milestone is published. It proves that pmem can write and restore project memory with thick traces, trace-aware recall, module/decision inference, and next-step cleanup before adding heavier retrieval machinery.
- v0.8: **Hybrid Recall Engine**. Add SQLite FTS/BM25, field weighting, structured filters, graph expansion, recency scoring, module/decision boosts, task-aware ranking, must-read context packing, and "why recalled" explanations.
- v0.8.5: **Lightweight Semantic Layer**. Add optional fuzzy semantic search only after the hybrid engine exists. Prefer Transformers.js + MiniLM-style embeddings + SQLite BLOB + linear cosine scan for single-project scale before considering Qdrant, Milvus, Vespa, turbovec, or sqlite-vec.
- v0.9: **Rerank + Contextual Retrieval**. Add contextual chunks, query rewrite, small-to-big retrieval, candidate reranking, and citation/evidence scoring.
- v1.0: **Project RAG OS**. Agent-facing memory CRUD becomes first-class: remember, forget, supersede, promote, distill, search, context, doctor memory, and verify.

## v0.8 Research Gate

Before implementing v0.8, run `task.rag_research_sprint_20260626` and produce a concrete architecture decision for `feature.v0_8_hybrid_recall_engine_20260626`.

The research gate must answer:

- What candidate-generation stages run in v0.8?
- How do BM25/FTS, exact IDs, source files, metadata filters, graph expansion, and recency combine?
- Which ranking signals are deterministic and explainable?
- Which signals are deferred to v0.8.5/v0.9?
- What evaluation set proves recall improved?

## Deferred Threads

- The old v0.7.5 graph visualization card remains useful as a human-inspection idea, but it is no longer the immediate v0.7.5 milestone boundary after the 2026-06-26 repositioning.
- MCP / `pmem-rt` is still a separate runtime direction and should not be silently absorbed into v0.8 retrieval work.
- Heavy vector databases are not the default path for single-project pmem; they are scale options after the SQLite-first path has real evidence.

## Product Principle

Do not trade trust for cleverness. pmem should get cheaper, faster, and smarter while keeping Markdown cards as source of truth and keeping important writes explicit.
