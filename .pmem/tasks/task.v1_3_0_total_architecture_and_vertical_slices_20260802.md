---
id: task.v1_3_0_total_architecture_and_vertical_slices_20260802
type: task
title: "v1.3.0 Total Architecture and Vertical Slice Plan"
status: active
tags: [v1.3.0, roadmap, implementation-plan, runtime, schema, backend, projection]
created: "2026-08-02"
updated: "2026-08-02T00:00:00.000Z"
depends_on:
  - decision.v1_3_0_runtime_first_schema_driven_backend_pluggable_20260802
  - decision.pmem_two_layer_architecture_20260722
related_to:
  - feature.v1_0_agentic_memory_runtime_20260722
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
  - module.recall_retrieval_runtime_20260626
classification: plan
token_policy: relaxed
trust_label: user_confirmed
sensitivity: internal
---

# v1.3.0 Total Architecture and Vertical Slice Plan

## One-sentence objective

将 pmem 从内置领域类型的 Markdown 项目记忆工具升级为 Runtime-first、Schema-driven、Backend-pluggable 的通用记忆运行时，同时保持 1.2 用户路径和确定性检索可用。

## Current baseline and migration map

- `src/runtime/index.ts` already exposes `Pmem`, but directly opens SQLite and calls `core/*` helpers; it is the first Runtime extraction seam.
- `src/runtime/types.ts` contains scope, policy, event, and public SDK types, but `MemoryRecord`/`MemorySchema`/`MemoryBackend` are not canonical yet.
- `src/core/db.ts` owns the SQLite schema and table operations; it becomes the first `storage/sqlite` adapter behind backend ports.
- `src/types/cards.ts` and `src/core/manifest.ts` encode legacy Card/manifest compatibility; they move behind `compatibility/v1_2.ts` and schema adapters.
- `src/core/query/**` contains a valuable five-stage hybrid pipeline; it becomes retriever implementations behind `query/planner.ts` and `query/executor.ts`.
- `src/core/capture.ts`, `src/commands/update.ts`, `src/commands/rebuild.ts`, `src/runtime/event-store.ts`, and `src/mcp/server.ts` currently own overlapping write/index/event boundaries; they must converge on Runtime transactions.

## Final target tree

```text
src/
├── runtime/          # lifecycle, transaction, scope, policy, errors
├── schema/           # registry, validation, builtins, definitions
├── storage/          # ports; sqlite and markdown adapters
├── query/            # plans, executor, retriever registry, context builder
├── extensions/       # extension registry, fragments, hooks
├── compatibility/    # v1_2 manifest/Card/CLI adapters only
├── sdk/              # public Runtime types and factory
├── mcp/              # protocol adapter over Runtime
└── commands/         # thin CLI adapters over Runtime
```

`src/core/` is not deleted in one rewrite; each owned responsibility moves into a target boundary, and the old path is removed only when no caller remains.

## Vertical slices

### VS-1 — Canonical model and backend ports

Define `MemoryRecord`, `MemoryEvent`, `MemorySchema`, `MemoryBackend`, transaction/store ports, typed errors, and conversion contracts. Implement `SqliteMemoryBackend` by wrapping existing SQLite behavior without changing user-visible commands. Add a real `Pmem.open({ root, backend, schema })` caller and contract tests.

Exit: Runtime imports no SQLite package; SQLite adapter passes read/write/event/relation/search contract tests; old tests remain green.

### VS-2 — Runtime lifecycle over the backend

Route `get`, `query`, `observe`, `commit`, `supersede`, and `forget` through Runtime lifecycle services. Preserve existing `ask`, `recall`, `context`, `capture`, and `endSession` facades as compatibility methods. Add policy/scope/provenance/lifecycle mapping and atomic backend transaction tests.

Exit: SDK, CLI, and MCP can perform the same lifecycle operation through one Runtime instance; no command writes directly to `core/db`.

### VS-3 — Schema registry and compatibility schema

Create runtime schema loading/validation and custom type/relation registration. Ship only minimal generic builtins (`memory`, `event`) in the new registry. Map old software/novel/research manifests to external-style schema fragments in `compatibility/v1_2.ts`; preserve `pmem new` and arbitrary custom types without source edits.

Exit: a test-defined type can be created, validated, stored, queried, and projected without modifying pmem source; old manifests load unchanged.

### VS-4 — Markdown Projection and legacy import/export

Implement Markdown import, export, and rebuild as a projection adapter. Preserve human editing, Git diffs, frontmatter migration, wikilinks, and source paths. Add projection journal, conflict detection, crash recovery, and explicit projection health state; do not describe filesystem writes as SQLite ACID.

Exit: an old 1.2 project round-trips Markdown → backend → Markdown byte/semantic-equivalent; direct Markdown edits re-import; projection failure is recoverable and visible.

### VS-5 — Unified transaction coordinator

Move capture/update/rebuild/event append/relation updates/search-index refresh behind one Runtime transaction coordinator. Use the backend transaction for canonical data and a durable projection journal for file side effects. Remove command-owned cross-module transaction code only after equivalent failure-injection tests exist.

Exit: injected failures prove no partial canonical record/event/relation/search state; retries recover projections and do not duplicate events.

### VS-6 — Standard Query Plan and Retriever registry

Define `MemoryQuery`, structured filters, scope/time validity, explanation, and retriever interfaces. Port current exact/lexical/FTS/graph/semantic/rerank/context-packing channels as registered implementations. Keep deterministic channels authoritative and semantic optional.

Exit: existing retrieval fixtures and JSON diagnostics pass through the new executor; a custom retriever can be added without editing executor code.

### VS-7 — Extension API

Add extension manifest/loading, schema fragments, retrievers, validators, projectors, health checks, and before/after commit hooks. Enforce namespacing, version compatibility, capability boundaries, deterministic ordering, and failure isolation. Package software/novel/research schemas outside Runtime ownership.

Exit: an external-style test extension contributes a type and retriever, is listed/validated, and cannot bypass Runtime policy or write outside its scope.

### VS-8 — Integration convergence and legacy removal

Make CLI, SDK, MCP, semantic companion, health/verify, and maintenance commands call the same Runtime factory. Delete direct table queries, domain checks, and Markdown-as-truth assumptions from Runtime. Retain only the v1.2 compatibility adapter and documented migration diagnostics.

Exit: CLI/SDK/MCP parity tests pass; `rg` confirms no forbidden Runtime → SQLite/Card/Markdown/domain imports; 1.2 projects work without manual bulk edits.

## Cross-cutting Definition of Done

- `npm test`, build, E2E, package audit, and `pmem verify` pass.
- New abstraction has at least one production caller and one failure-path test.
- Every write has an event and scope/provenance/lifecycle metadata.
- Backend switching does not alter Runtime or Query code.
- Custom schemas/extensions do not require pmem source edits.
- Deterministic retrieval remains usable when semantic runtime is absent or partial.
- Public JSON, MCP security, and `Pmem.open({ root })` compatibility are tested.
- No `docs/` directory is introduced; this card and the linked decision are canonical project memory.

## Development control

Use one continuous branch named `Perview/v1.3.0-runtime-first`. Every PR must implement one vertical slice or a strictly smaller contract sub-slice, be independently mergeable, and leave the final target architecture closer—not create a temporary parallel architecture. The first implementation PR is VS-1.

## Immediate next action

Before coding VS-1, freeze the TypeScript contracts for `MemoryRecord`, `MemoryEvent`, `MemorySchema`, `MemoryBackend`, `MemoryTransaction`, and the legacy Card/Manifest conversion boundary. No command migration or domain deletion belongs in that first PR.
