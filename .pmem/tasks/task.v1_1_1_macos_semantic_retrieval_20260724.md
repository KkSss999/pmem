---
id: task.v1_1_1_macos_semantic_retrieval_20260724
type: task
title: "v1.1.1 graph-aware semantic retrieval"
status: completed
priority: P0
classification: plan
trust_label: agent_generated
sensitivity: internal
token_policy: relaxed
tags: [v1.1.1, macos, semantic-search, graph-retrieval, acceptance]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - .pmem/manifest.yml
  - src/core/db.ts
  - src/core/query/engine/candidates.ts
  - src/core/query/engine/scoring.ts
  - src/commands/rebuild.ts
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

> Release disposition: implementation is complete but will not be published as v1.1.1. It is the semantic foundation of the unified v1.2.0 release.

## Goal

Make pmem better at finding semantically similar project memory while preserving its lightweight, local-first, graph-structured retrieval model.

## Locked User Contract

- Default `pmem` install, `init`, `rebuild`, `ask`, and `context` remain offline-compatible and never download a model.
- `pmem semantic setup` is the only first-time download/enable path. It shows model ID, revision, cache path, approximate download size, and asks for confirmation unless `--yes` is supplied.
- `pmem semantic status`, `pmem semantic rebuild`, and `pmem semantic clear` expose state, rebuild derived vectors, and remove/disable semantic data without changing Markdown cards.
- Use `@huggingface/transformers` through dynamic import with the pinned ONNX export of `intfloat/multilingual-e5-small`. After setup, inference must work with remote model loading disabled.
- Embed queries as `query: ...` and chunks as `passage: ...`; normalize vectors before storage and cosine scan.

## Implementation Workstreams

1. **Evaluation first:** add a versioned corpus of at least 60 labelled queries: 20 Chinese, 20 English, and 20 code/path/mixed-language cases. Record deterministic Recall@5, MRR, exact-ID/path success, latency, and fixture version before semantic code lands.
2. **Semantic core:** create deterministic heading-aware chunks with stable IDs derived from `card_id + heading path + ordinal + content hash`. Include title, summary, and section body; respect the model's 512-token ceiling and split oversized sections deterministically.
3. **SQLite lifecycle:** add `semantic_meta` and `semantic_chunks` as derived tables containing model/revision/dimension/content hash/vector BLOB. Full rebuild recreates them; incremental rebuild only re-embeds changed safe chunks and deletes removed-card chunks.
4. **Safety boundary:** exclude `sensitivity: secret`, `trust_label` other than explicitly trusted, candidates, and deleted/superseded cards before provider invocation. Test with a spy provider so excluded text is proven never to cross the embedding boundary.
5. **Hybrid fusion:** add a `semantic` candidate channel after deterministic seed collection and before graph expansion. Collapse chunk hits to parent cards, cap semantic seeds, retain best chunk evidence, then run existing trust/staleness/status/scoring and graph expansion. Exact ID/title/path remains rank-authoritative.
6. **CLI and operations:** implement setup/status/rebuild/clear, manifest validation, cache integrity checks, actionable offline/missing-model errors, progress output, and crash-safe transactional index replacement.

## Data and Explain Contract

`ask --explain --format json` must expose `semantic` as a candidate reason with similarity, chunk ID, heading, model revision, and parent card. Packed/card output remains parent-card based; chunk text is evidence, never a new source-of-truth object. A disabled, missing, corrupt, or incompatible semantic index degrades to the current deterministic path with a warning only when semantic mode was explicitly enabled.

## Acceptance Gate

- Security tests prove excluded content never reaches the provider or semantic tables; no model/network activity occurs before explicit setup.
- Exact ID/path/title queries retain 100% fixture success with semantic disabled and enabled; all existing unit/E2E tests pass.
- On the locked 60+ query corpus, semantic-enabled Recall@5 improves by at least 15 percentage points overall, MRR does not decline, and no language slice loses more than 5 points versus deterministic baseline.
- Every semantic hit reports parent-card and chunk provenance; graph-expanded results still report edge provenance.
- Full, incremental, delete, clear, rebuild, corrupted-cache, offline, and interrupted-index scenarios pass on both Apple Silicon and Intel macOS CI/runners when available; Apple Silicon is the release-blocking reference runner.
- Default disabled-path `ask` latency changes by no more than 10%. Record warm semantic query p50/p95 and index build time for a 300-card fixture; these measurements become the baseline rather than an unmeasured performance claim.
- `npm test`, `npm run build`, install smoke, real-workflow E2E, `pmem rebuild`, and `pmem verify` are green before version bump, changelog, package dry-run, and release.

## Explicitly Out of Scope

Cloud embeddings, mandatory vector databases/extensions, ANN search, contextual reranking, daemon/service work, Miao-specific integration, semantic write decisions, non-macOS acceptance, and replacing deterministic or graph retrieval.

## Acceptance Record

- ModelScope download and fully offline inference passed with the shared cache at `~/.pmem-global/models/Xenova/multilingual-e5-small/761b726dd34fb83930e26aab4e9ac3899aa1fa78`.
- Locked 60-query fixture: Recall@5 `0.716667 -> 0.866667`; MRR `0.660147 -> 0.836052`; exact ID/path/title authority `60/60`.
- Semantic slices: Chinese Recall@5 `0.85`, English `0.90`, code/path/mixed `0.85`; no slice regressed from the deterministic baseline.
- Default-disabled deterministic latency remained within the 10% gate: mean `+0.75%`, p50 `+4.86%`, p95 `+1.97%`.
- macOS arm64 300-card fixture: full index `1442.366 ms`; warm query p50/p95 `4.402/5.639 ms`.
- Intel macOS runner was not available for this development session; Apple Silicon remains the release-blocking verified platform.
