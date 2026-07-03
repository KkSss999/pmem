---
id: decision.v0_8_hybrid_recall_engine_architecture_20260703
type: decision
title: "v0.8 Hybrid Recall Engine Architecture"
status: active
tags: [v0.8, retrieval, hybrid-search, bm25, scoring, explain, budget, architecture]
created: "2026-07-03"
updated: "2026-07-03T00:00:00.000Z"
source_files:
  - docs/v0.8 pre-design.md
  - src/commands/ask.ts
  - src/commands/recall.ts
  - src/core/format.ts
  - src/core/db.ts
  - src/core/query/ask.ts
  - src/core/query/recall.ts
  - src/core/query/context.ts
  - src/core/query/engine/intent.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
  - src/core/query/engine/pack.ts
depends_on:
  - decision.structure_first_hybrid_recall_20260626
related:
  - feature.v0_8_hybrid_recall_engine_20260626
  - task.rag_research_sprint_20260626
  - module.recall_retrieval_runtime_20260626
last_verified: "2026-07-03T00:00:00.000Z"
---
# v0.8 Hybrid Recall Engine Architecture

## Decision

v0.8 implements a five-stage deterministic retrieval pipeline: intent parse → multi-channel candidate generation (exact id / alias / tag / **source_files** / **always-on FTS5 bm25 with field weights**) → graph expansion with score inheritance and hop decay → multiplicative score fusion (base × type_weight × recency × staleness_penalty × status) → L0-L3 budgeted context packing. Full design in `docs/v0.8 pre-design.md`.

## Key Points

- FTS becomes an always-on fusion channel (capped base 0.8), no longer a zero-hit fallback.
- New source_file channel: queries containing file paths hit cards via the `paths` table (independent candidate channel, not part of FTS).
- Stale/dirty cards are down-weighted (×0.7 dirty, ×0.9 unverified), never hidden.
- Every recalled item carries machine-readable `reasons` + `factors` (explainability contract from [[decision.structure_first_hybrid_recall_20260626]]).
- Deterministic: tie-break by card id; timestamp injected once at entry.
- Budget packing is layered (L0 never trimmed), replacing tail truncation.
- Zero migration for users: no Markdown card schema change, no manual migration needed. `pmem rebuild` automatically creates/refreshes the SQLite runtime FTS index `card_fts` — it is a rebuildable artifact, not a schema migration.

## Explicit Deferrals

- Embeddings / semantic layer → v0.8.5 ([[decision.sqlite_first_semantic_layer_20260626]])
- LLM rerank / contextual retrieval → v0.9
- Card body chunking → whole-card recall unit in v0.8
- New MCP tool surface → existing tools benefit transparently
