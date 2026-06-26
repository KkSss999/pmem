---
id: feature.v1_0_project_rag_os_20260626
type: feature
title: "v1.0 Project RAG OS"
status: draft
tags: [v1.0, project-rag-os, agent-crud, memory-lifecycle, verification]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/manifest.yml
  - src/commands/update.ts
  - src/commands/capture.ts
  - src/commands/distill.ts
  - src/commands/verify.ts
depends_on:
  - decision.project_rag_os_positioning_20260626
  - feature.v0_9_contextual_rerank_retrieval_20260626
related_to:
  - task.post_v0_7_optimization_roadmap_20260602
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:15:00.000Z"
---
# v1.0 Project RAG OS

## Goal

Make pmem an agent-operable local knowledge OS for project work. Retrieval is only one side; agents also need safe, explicit memory lifecycle operations.

## Capabilities

- `remember`: create durable memory from evidence.
- `forget` or archive: remove obsolete recall surface without losing auditability.
- `supersede`: replace stale decisions or tasks with a clear successor.
- `promote`: turn inferred candidates or traces into stable cards.
- `distill`: consolidate trace history into durable project memory.
- `search` and `context`: retrieve evidence-backed context packs.
- `doctor memory` and `verify`: check freshness, consistency, orphan links, stale cards, and source coverage.

## Acceptance

Agents can perform CRUD-like memory operations without editing SQLite directly, while Markdown cards remain the canonical source of truth and important writes remain explicit and reviewable.
