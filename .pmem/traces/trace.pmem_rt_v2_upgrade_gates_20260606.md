---
id: trace.pmem_rt_v2_upgrade_gates_20260606
type: trace
title: "pmem-rt v2 Upgrade Gates"
status: draft
tags: [pmem-rt, mcp, v2, upgrade, gates, deferral, benchmark]
created: "2026-06-06"
source_files: []
depends_on: []
related_to:
  - decision.pmem_rt_v1_thin_mcp_adapter_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
  - risk.pmem_rt_v1_security_threat_model_20260606
---
# pmem-rt v2 Upgrade Gates

> Each deferred item has a measurable trigger that must be observed in real usage before v2 work begins. **Abstractions are driven by the second consumer, not the first.** Triggers are reviewed after any new feature touching v1 surface, before any v1.x release, and quarterly. Re-evaluation does **not** authorize v2 work — it only checks whether any trigger has fired. v2 work is authorized by a new decision card citing the fired trigger.

## Gating Triggers

### HTTP transport

- **Trigger**: More than one agent runtime concurrently needs the same `.pmem/` **and** stdio-per-session is too costly to spawn.
- **Evidence**: User reports, agent framework logs, cold-start measurements.
- **Why deferred**: HTTP brings lifecycle, port, concurrency, permissions, multi-agent sharing semantics, and a larger test matrix.

### `pmem-rt-core` extraction

- **Trigger**: A second consumer outside `pmem-ai` needs the same query logic — third-party agent framework, HTTP server, IDE plugin, SDK.
- **Evidence**: npm downloads, GitHub import requests, partner integrations.
- **Why deferred**: Extracting before the second consumer produces an abstraction that fits only one shape.

### File watcher

- **Trigger**: `pmem mcp` median > 100ms **and** p95 > 500ms, with `pmem.db` < 50MB.
- **Evidence**: Benchmarks on real projects at 100 / 1000 / 5000 cards.
- **Why deferred**: SQLite local queries are likely fast enough for the v1 surface; watcher complexity pays off only when reads are provably slow.

### Cache layer

- **Trigger**: Same query pattern > 30% of tool calls **and** recompute > 50ms median.
- **Evidence**: Profiling of real agent sessions.
- **Why deferred**: Caches are correctness hazards; complexity shifts from "be correct" to "be fast *and* correct".

### Materialized views

- **Trigger**: `pmem_related` depth ≥ 2 exceeds p95 200ms at 1000+ card scale.
- **Evidence**: Benchmarks across 100 / 1000 / 5000 / 10000 card projects.
- **Why deferred**: v1 keeps `pmem_related` at depth 1; depth-2+ queries aren't enabled in v1.

### Multi-project runtime

- **Trigger**: At least three users independently request cross-project queries.
- **Evidence**: Issue tracker, community channels, dogfooding.
- **Why deferred**: One process per `.pmem/` is the simplest model; multi-project raises scope, permission, and ranking questions.

### Embedding / vector search

- **Trigger**: Agents bottlenecked on **lexical** search, not latency — `pmem_ask` returns poor matches where the issue is vocabulary mismatch, not missing cards.
- **Evidence**: Issue reports, agent session logs, qualitative feedback.
- **Why deferred**: Embeddings add model weights, runtime, indexing pipeline, ranking instability, and maintenance burden.

### Write tools via MCP

- **Trigger**: Confirmation-first UX provably hurts agent workflows — measurable pattern of agents needing to record observations mid-task.
- **Evidence**: User research, observed agent behavior, framework telemetry.
- **Why deferred**: Highest-trust boundary. If blocked, prefer a narrower write surface (append-only trace-log with human-reviewed batch promotion), not an open `pmem_update` MCP tool.
