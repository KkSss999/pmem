---
id: module.recall_retrieval_runtime_20260626
type: module
title: "Recall and Retrieval Runtime"
status: active
tags: [recall, ask, query, retrieval, rag, sqlite]
created: "2026-06-26"
updated: "2026-07-03T00:00:00.000Z"
source_files:
  - src/commands/recall.ts
  - src/commands/ask.ts
  - src/commands/context.ts
  - src/core/query/recall.ts
  - src/core/query/ask.ts
  - src/core/query/related.ts
  - src/core/query/context.ts
  - src/core/query/status.ts
  - src/core/query/engine/intent.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
  - src/core/query/engine/pack.ts
depends_on:
  - module.manifest_runtime_20260602
related_to:
  - decision.structure_first_hybrid_recall_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
last_verified: "2026-08-03T06:00:02.273Z"
classification: fact
trust_label: user_confirmed
sensitivity: internal
---
# Recall and Retrieval Runtime

## Responsibility

This module owns the agent-facing read path: restoring project context, answering task-specific memory questions, expanding related cards, and producing compact context packs for downstream coding agents.

## Current Scope

- CLI commands: `recall`, `ask`, and `context`.
- Core query functions under `src/core/query/`.
- Reads from Markdown-derived SQLite indexes, graph edges, card metadata, and trace history.

## Roadmap Role

This module becomes the implementation home for v0.8 Hybrid Recall Engine work. The next version should evolve it from card-level recall toward candidate generation, field-weighted scoring, graph expansion, recency scoring, and explainable must-read packing.

## Boundary

This module should not own memory writes. Write-side lifecycle commands such as `update`, `capture`, `distill`, `decision infer`, and `module infer` remain separate but must provide retrieval-friendly evidence and provenance.
