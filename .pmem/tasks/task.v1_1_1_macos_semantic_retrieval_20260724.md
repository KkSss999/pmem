---
id: task.v1_1_1_macos_semantic_retrieval_20260724
type: task
title: "v1.1.1 graph-aware semantic retrieval"
status: planned
priority: P0
tags: [v1.1.1, macos, semantic-search, graph-retrieval, acceptance]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - .pmem/manifest.yml
  - src/core/db.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
  - src/commands/ask.ts
  - src/commands/context.ts
depends_on:
  - decision.v1_1_1_macos_semantic_retrieval_20260724
  - decision.post_v1_1_macos_required_platform_20260724
  - feature.v1_1_1_lightweight_semantic_layer_20260626
related_to:
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
---
# v1.1.1 Semantic Retrieval

## Goal

Make pmem better at finding semantically similar project memory while preserving its lightweight, local-first, graph-structured retrieval model.

## Delivery Logic

1. Create a labelled Chinese/English/code query corpus and record the deterministic baseline before adding vectors.
2. Add an explicit macOS-only setup path for `multilingual-e5-small`; no model download or semantic behavior occurs by default.
3. Split cards by headings, derive safe chunks, and store their normalized vectors as rebuildable SQLite BLOB data.
4. Use vector search only to produce candidate parent cards; merge those candidates into the current deterministic scoring and graph expansion pipeline with visible reasons.
5. Verify offline default behavior, explicit setup, incremental update/delete rebuild, privacy exclusions, recall quality, and macOS install workflow before release.

## Acceptance Gate

- `secret` and default-untrusted content never reaches the embedding provider or semantic tables.
- Exact ID/path/title retrieval never regresses when semantic search is disabled or enabled.
- Paraphrase queries improve against the recorded baseline and every semantic hit names its parent card and graph evidence.
- The semantic index can be cleared and rebuilt without touching Markdown source cards.
- macOS is fully tested under the post-v1.1.0 platform policy; other systems are not release blockers unless a later decision expands support.
