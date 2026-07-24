---
id: decision.v1_2_0_unified_memory_intelligence_release_20260724
type: decision
title: "v1.2.0 Unified Memory Intelligence Release"
status: accepted
classification: decision
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.0, semantic-retrieval, memory-health, contextual-rerank, release]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - src/core/query/ask.ts
  - src/commands/verify.ts
  - src/commands/semantic.ts
related_to:
  - decision.v1_1_1_macos_semantic_retrieval_20260724
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
---
# v1.2.0 Unified Memory Intelligence Release

## Decision

Do not publish the implemented v1.1.1 semantic layer as a standalone release. Combine it with memory-health migration and local contextual reranking, then ship and accept the result only as v1.2.0.

The release is one acceptance unit with three capabilities: semantic retrieval finds relevant memory, contextual reranking orders it accurately, and memory health explains whether the underlying project memory and semantic index are trustworthy.

## Product Boundary

- Keep one retrieval engine: deterministic retrieval is always the authority-preserving base; semantic retrieval and contextual reranking are optional augmentations.
- Use the same pinned local multilingual E5 model. Do not add a cross-encoder, second model, cloud embeddings, or mandatory network activity.
- Keep Markdown cards canonical and all vectors, health indexes, and rerank state rebuildable.
- Preserve exact ID/title/path authority, graph provenance, safety allowlists, offline degradation, and existing CLI/SDK compatibility.
- Treat download source as provenance only; all projects share one verified global model cache under `~/.pmem-global/models`.

## Delivery Boundary

No staging, commit, push, tag, publish, or pull request may occur until every v1.2.0 close condition passes and the user has reviewed the final acceptance report.
