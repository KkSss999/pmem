---
id: task.v1_2_0_unified_release_20260724
type: task
title: "Develop and accept complete v1.2.0"
status: completed
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
token_policy: relaxed
tags: [v1.2.0, semantic-retrieval, memory-health, migration, contextual-rerank, acceptance]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - package.json
  - src/core/query/ask.ts
  - src/core/query/engine/scoring.ts
  - src/core/semantic/chunks.ts
  - src/commands/verify.ts
  - src/index.ts
depends_on:
  - decision.v1_2_0_unified_memory_intelligence_release_20260724
related_to:
  - task.v1_1_1_macos_semantic_retrieval_20260724
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
---
# v1.2.0 Unified Development and Acceptance

## Goal

Deliver semantic recall, meaningful memory-health diagnostics and safe metadata migration, plus local contextual reranking as one coherent v1.2.0 release.

## Locked Scope

### Semantic foundation

- Carry the completed v1.1.1 implementation into v1.2.0 without an intermediate release.
- Preserve explicit setup, ModelScope default source, one global verified cache, offline inference, safe indexing, transactional snapshot revalidation, and deterministic fallback.
- Version contextual embeddings so old derived indexes become visibly incompatible and require rebuild without downloading the model again.

### Memory health and migration

- Refactor verification into issue collection, aggregation, dimension scoring, baseline comparison, rendering, and repair boundaries.
- Report backward-compatible `score` plus `overall_score`, nullable `change_score`, and `correctness`, `freshness`, `metadata`, and `semantic_readiness` dimensions.
- Aggregate repeated stale evidence per card and use bounded, diminishing penalties so a mature repository retains a meaningful score.
- Store an explicit versioned health baseline in `.pmem/health-baseline.json`; no baseline means `change_score: null`, never an invented perfect score.
- Add dry-run-first, confirmation-gated metadata migration that only fills missing fields, never silently grants user/system trust, preserves Markdown formatting, backs up before writes, holds the pmem lock, rebuilds after success, and is idempotent.
- Extend semantic status/readiness with eligible and excluded card counts/reasons, cache integrity, index compatibility, and freshness.

### Contextual retrieval and reranking

- Add deterministic query planning and a local TypeScript second-stage reranker over the bounded candidate set; do not add another model.
- Contextual chunks may include safe card ID/type/status, title, summary, heading, aliases, tags, source paths, and one-hop relation IDs. Freshness remains a runtime feature and must not force re-embedding.
- Preserve raw query embedding, exact authority, all original reasons, parent-card output, semantic chunk evidence, and graph `from_card`/`edge_type` provenance.
- Expose rerank explanation separately from candidate-channel reasons and degrade exactly to the established deterministic order when semantic/rerank state is unavailable.

## Unified Acceptance Gate

- Existing manifests and Markdown cards remain backward compatible; default install/init/rebuild/ask/context performs no model download and semantic-disabled latency changes by no more than 10%.
- All secret, non-allowlisted trust, candidate, deleted, and superseded content and contextual metadata are excluded before provider invocation and from semantic tables.
- Exact ID/title/path success is 100% with semantic disabled and enabled; graph provenance survives reranking.
- On the locked 60-query set, Recall@5 remains at least `0.866667`, MRR improves from `0.836052` by at least `0.02`, and no language slice loses more than `0.05` Recall@5.
- Add at least 30 hard-negative rerank queries; candidate Recall@50 is at least `0.98` and NDCG@10 improves by at least 5 percentage points over the v1.1.1 semantic ordering.
- On the 300-card Apple Silicon fixture, contextual full rebuild is no more than 1.25x the isolated v1.1.1 baseline and warm query p95 is no more than 1.2x or 2 ms above it, whichever allowance is larger.
- Health output de-duplicates stale evidence per card, retains legacy `score`, reports a non-saturated overall score for this repository, reports `change_score: null` without a baseline, and reaches change score 100 after an explicit accepted baseline with no new issues. A deliberately introduced warning must lower change score.
- Migration dry-run writes nothing; apply requires explicit trust/sensitivity choices, is atomic, backed up, idempotent, does not overwrite existing metadata, and rebuilds the database consistently.
- `npm test`, build, live semantic evaluation, install smoke, real-workflow E2E, package dry-run, `pmem rebuild`, and `pmem verify --format json` complete with recorded evidence.
- Apple Silicon macOS is the release-blocking platform. Intel macOS remains additional evidence when a runner is available.
- Do not stage, commit, push, tag, publish, or create a PR before the user accepts the final v1.2.0 report.

## Explicitly Out of Scope

Cloud embeddings, a second reranker model, cross-encoder/LLM reranking, ANN/vector services, automatic memory writes, daemon/REST/UI work, non-macOS release blocking, and per-project copies of the model.

## Acceptance Record

Validated locally on Apple Silicon macOS on 2026-07-24 as one v1.2.0 development unit:

- Build passed and the final full automated suite passed: 386 tests, 0 failures, 1 explicitly gated live-evaluation skip in the ordinary suite.
- The separately enabled live semantic evaluation passed all release gates: Recall@5 `0.933333`, MRR `0.862058`, candidate Recall@50 `1.0`, and exact ID/title/path success `60/60`.
- All language slices improved or remained above the locked v1.1.1 values: zh `0.95`, en `0.90`, and code/path mixed `0.95` Recall@5.
- The 30-query hard-negative set improved NDCG@10 from `0.871031` to `0.935387` (`+0.064356`).
- The final 300-card fixture completed a full contextual build in `1592.253 ms` with warm-query p95 `6.915 ms`, within the locked `1802.958 ms` and `12 ms` ceilings.
- The isolated semantic-disabled path remained within the 10% latency gate: mean `+4.05%`, p50 `+7.55%`, p95 `+2.46%` versus the locked baseline.
- Final health scoring reports this repository at overall `70`, correctness `100`, freshness `80`, metadata `90`, and semantic readiness not applicable while disabled; `change_score` is correctly null without an accepted baseline.
- Baseline comparison, deliberate-warning regression, aggregation, migration dry-run/apply/rollback/backup/idempotence, nested lock ownership, semantic readiness, and safe exclusion behavior are covered by passing tests.
- Final read-only review found no remaining blocking or non-blocking issues after production evidence-count wiring, JSON repair-mode validation, double-layer migration rollback, and healthy empty-index handling were verified.
- Repository migration dry-run scanned 39 cards, proposed changes to 33, left 36 explicit trust/sensitivity decisions unresolved, and wrote no files.
- Install smoke, real-workflow E2E, npm package dry-run, and whitespace validation passed.

No staging, commit, push, tag, publish, or pull request was performed. User review remains the explicit prerequisite for discussing repository publication actions.
