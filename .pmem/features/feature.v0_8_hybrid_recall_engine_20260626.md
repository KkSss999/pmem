---
id: feature.v0_8_hybrid_recall_engine_20260626
type: feature
title: "v0.8 Hybrid Recall Engine"
status: completed
tags: [v0.8, retrieval, hybrid-search, bm25, graph, recall]
created: "2026-06-26"
updated: "2026-07-03T00:00:00.000Z"
source_files:
  - src/commands/ask.ts
  - src/commands/recall.ts
  - src/core/format.ts
  - src/core/db.ts
  - src/core/query/recall.ts
  - src/core/query/ask.ts
  - src/core/query/context.ts
  - src/core/query/related.ts
  - src/core/query/engine/intent.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
  - src/core/query/engine/pack.ts
depends_on:
  - decision.structure_first_hybrid_recall_20260626
related_to:
  - module.recall_retrieval_runtime_20260626
  - task.rag_research_sprint_20260626
  - feature.v1_1_1_lightweight_semantic_layer_20260626
last_verified: "2026-07-03T00:00:00.000Z"
---
# v0.8 Hybrid Recall Engine

## Goal

Make pmem retrieve the right project context for a task, not just summarize active memory. v0.8 should improve precision and explainability using local deterministic signals before adding semantic embeddings.

## Scope

- SQLite FTS/BM25 over card title, body, tags, source files, and selected metadata.
- Field weighting so exact card IDs, titles, source files, and decision/module matches outrank incidental body text.
- Metadata filters by type, status, tag, source file, recency, dirty/stale state, and version/milestone where available.
- Graph expansion from seed hits to related modules, decisions, traces, risks, and tasks.
- Recency and freshness scoring that does not let stale memory silently dominate.
- Task-aware ranking and must-read context packing.
- Explainable output: each recalled item should have a short reason.

## Acceptance

- A task query can produce a bounded candidate set and a packed context list.
- The same query result is deterministic when the index has not changed.
- Tests cover exact ID/file lookup, fuzzy keyword lookup, graph expansion, stale-card handling, and budget-limited packing.
- The architecture decision from `task.rag_research_sprint_20260626` has been accepted.
