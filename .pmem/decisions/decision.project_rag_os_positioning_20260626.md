---
id: decision.project_rag_os_positioning_20260626
type: decision
title: "pmem Positioning: Project RAG OS"
status: active
tags: [positioning, rag, project-memory, agent-crud, roadmap]
created: "2026-06-26"
updated: "2026-06-26T12:15:00.000Z"
source_files:
  - .pmem/state.md
  - .pmem/next.md
depends_on:
  - decision.dogfood_pmem_for_pmem_development_20260602
related_to:
  - task.post_v0_7_optimization_roadmap_20260602
  - feature.v1_0_project_rag_os_20260626
  - decision.structure_first_hybrid_recall_20260626
  - risk.rag_scope_creep_heavy_vector_stack_20260626
last_verified: "2026-06-26T12:19:26.213Z"
---
# pmem Positioning: Project RAG OS

## Decision

pmem's target identity is **Project RAG OS**: structured project memory plus high-quality retrieval plus agent-operable memory CRUD. It should not be positioned as only a project log, a chat-history compressor, or a vector database wrapper.

## Product Definition

The durable product shape is:

- structured Markdown cards as source of truth;
- SQLite indexes for fast local operation;
- graph-aware project memory over project, module, decision, trace, task, source file, symbol, and next-step entities;
- high-quality recall using hybrid retrieval and context packing;
- agent-safe CRUD operations: create, read, update, delete/archive, verify, distill, supersede, and rollback.

## Rationale

Project memory retrieval is different from generic document QA. pmem is retrieving project state for future agent action, so evidence, freshness, provenance, and update semantics matter as much as recall quality. The system must make it clear which memory is current, why it was recalled, what it supersedes, and how an agent may safely change it.

## Consequences

- The roadmap should be framed around recall quality, memory lifecycle, evidence traceability, and agent CRUD rather than "add a vector DB".
- RAG work must remain structure-first: cards, graph edges, source files, trace history, symbols, and metadata are primary signals.
- Semantic search is useful, but it is an enhancement layer after deterministic recall is reliable.
