---
id: decision.v1_1_1_macos_semantic_retrieval_20260724
type: decision
title: "v1.1.1 Semantic Retrieval: multilingual-e5-small with graph-first fusion"
status: active
tags: [v1.1.1, macos, semantic-search, embeddings, sqlite, graph-retrieval]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - .pmem/manifest.yml
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
depends_on:
  - decision.sqlite_first_semantic_layer_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - decision.post_v1_1_macos_required_platform_20260724
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
---
# v1.1.1 macOS Semantic Retrieval

## Decision

Under the post-v1.1.0 platform policy, v1.1.1 is implemented and accepted on macOS. It uses a user-approved local download of `multilingual-e5-small`, then stores normalized vectors in SQLite and scans them locally with cosine similarity.

## Retrieval Contract

Markdown cards remain the only source of truth. Cards are split by Markdown headings into stable chunks. Vector similarity only finds semantically relevant candidate chunks; each candidate maps back to its parent card, then enters the existing deterministic hybrid retrieval and graph expansion path.

Exact IDs, source paths, titles, FTS/BM25, trust, sensitivity, staleness, and supersession remain authoritative signals. Semantic similarity must be explainable and must never replace the graph structure with a flat vector result list.

## Safety and Lightweight Boundary

- The default installation has no model download, cloud embedding dependency, vector service, or vector database.
- Model download is a user-visible, explicit macOS setup action.
- `secret` and default-untrusted content are excluded before embedding and never enter the semantic index.
- Vectors are derived SQLite data and can be deleted and rebuilt from Markdown cards.
- Contextual reranking, daemon/service work, and Miao integration are not v1.1.1 scope. Platform expansion follows the separate post-v1.1.0 policy.

## Acceptance

Ship only when macOS setup is explicit and repeatable, semantic candidates improve the labelled paraphrase query set without regressing exact recall, every result retains card/graph provenance, and the default non-semantic CLI path remains unchanged.
