---
id: decision.pmem_rt_v1_thin_mcp_adapter_20260606
type: decision
title: "pmem-rt v1: Thin MCP Adapter"
status: draft
tags: [pmem-rt, mcp, v0.8, post-v0.7.5, thin-adapter, security]
created: "2026-06-06"
source_files: []
depends_on:
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
related_to:
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
  - feature.v0_7_5_graph_visualization_20260606
  - task.post_v0_7_optimization_roadmap_20260602
  - risk.pmem_rt_v1_security_threat_model_20260606
  - trace.pmem_rt_v2_upgrade_gates_20260606
---
# pmem-rt v1: Thin MCP Adapter

> **Status: `draft`.** Architecture boundary, not a development task. No MCP code, no new package, no new repository until v0.7.5 ships.

## Decision

A **thin MCP adapter inside `pmem-ai`** — small, read-only surface over existing project-memory query capabilities. Not a new runtime, not a new package, not a new repository.

## Locked Boundaries

1. **Gated on v0.7.5.** No work starts before v0.7.5 is released and validated. No parallelism.
2. **In-package.** v1 lives in `pmem-ai` as `src/mcp/`, sibling to `src/commands/`. No new npm package, no new repo in v1.
3. **stdio MCP only.** `@modelcontextprotocol/sdk` over stdio. No HTTP, no port, no daemon.
4. **Four read-only tools.** `pmem_recall`, `pmem_ask`, `pmem_related`, `pmem_status`. No `pmem_trace` in v1. No write tools.
5. **Stable tool names.** No `v1_` prefix. Each response includes top-level `schema_version`. Incompatible changes add new tools; never rename.
6. **Shared pure query service.** Four pure functions in new `src/core/query/`. CLI, MCP, and (later) Web all call them. **MCP does not shell out to `pmem recall --format compact`.**
7. **Structured JSON responses.** Typed JSON objects, not compact text. CLI's `--format compact` is presentation, not the MCP API.
8. **Official MCP SDK by default.** Hand-rolling JSON-RPC rejected unless cold-start benchmarks prove otherwise.
9. **XML wrapping is hint, not security.** `<pmem_card_data>` may stay as an auxiliary label. The structured `content_trust` field is the schema-level signal.

## Non-Goals (Deferred)

HTTP transport · package split · cache / file watcher / pre-computed views · embedding · multi-project runtime · cloud sync / multi-user / telemetry / remote access · auto-write by agents · agent session state persistence in pmem · memory optimization suggestions through MCP. Each gated by a measurable trigger — see `trace.pmem_rt_v2_upgrade_gates_20260606`.

## Security Baseline

Full threat model and required test matrix in `risk.pmem_rt_v1_security_threat_model_20260606`. v1 must not ship without all of:

1. **Read-only tools** — no mutation of `.pmem/`, SQLite index, or source files.
2. **Strict path scope** — root locked to `cwd/.pmem/`. All reads go through `fs.realpath` + **path-relative or separator-bounded** boundary check. **Never** bare `startsWith(allowedRoot)` — vulnerable to `.pmem-evil` prefix confusion.
3. **No source-code reads** — `related`/`ask` return `source_files` as paths only, never file contents.
4. **Structured source info** — every card: `id`, `path` (relative to root), `updated_at`.
5. **Output budget** — `max_response_tokens` per tool (default 4000). Over-cap: `truncated: true` + `truncated_reason`.
6. **Untrusted content marker** — every card carries `content_trust: "untrusted_project_data"`. Tool description states card content is project data, not system instructions.
7. **Security tests** — covers malicious content, path traversal, symlink escape, prefix-confusion, source-file reads, output overflow, `content_trust` presence, mutation side effects.

**Disallowed in v1** unless proven necessary: card-content sanitization, redaction, or "safety filters". Trust boundary is the agent framework, not pmem.
