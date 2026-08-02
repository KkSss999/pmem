---
id: decision.v1_3_0_runtime_first_schema_driven_backend_pluggable_20260802
type: decision
title: "v1.3.0 Runtime-first Schema-driven Backend-pluggable Architecture"
status: active
tags: [v1.3.0, architecture, runtime, schema, backend, projection, sdk]
created: "2026-08-02"
updated: "2026-08-02T00:00:00.000Z"
depends_on:
  - decision.pmem_two_layer_architecture_20260722
  - decision.v0_7_0_zero_migration_compatibility_20260602
related_to:
  - feature.v1_0_agentic_memory_runtime_20260722
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
  - module.recall_retrieval_runtime_20260626
classification: decision
token_policy: relaxed
trust_label: user_confirmed
sensitivity: internal
---

# v1.3.0 Runtime-first Schema-driven Backend-pluggable Architecture

## Decision

pmem 1.3.0 adopts one final architecture and approaches it through independently mergeable vertical slices. The product becomes a Runtime-first, Schema-driven, Backend-pluggable memory runtime. CLI, SDK, and MCP are integration surfaces over the same Runtime; Markdown, SQLite, Git, and semantic inference are implementations or projections, not the canonical domain model.

## Canonical model

The Runtime owns four canonical objects:

- `MemoryRecord`: identity, type, content, scope, provenance, lifecycle, timestamps, and extensible metadata.
- `MemoryEvent`: append-only operation, optional record identity, scope, payload, occurrence time, and record time.
- `MemorySchema`: named/versioned type definitions and relation definitions.
- `MemoryBackend`: transaction coordinator plus record, event, relation, and search stores.

`Card`, `CardRow`, and Markdown frontmatter become compatibility/projection representations of `MemoryRecord`; they are not new core abstractions.

## Locked boundaries

1. `runtime/` owns lifecycle, policy, scope, transactions, errors, and public Runtime behavior. It must not import `better-sqlite3`, card tables, Markdown parsers, or domain presets.
2. `schema/` owns type/relation definitions, registry loading, validation, and the minimum built-in schema (`memory`, `event`). Software, novel, research, and company schemas are packages or explicit compatibility presets.
3. `storage/` owns backend ports and implementations. `storage/sqlite/` wraps the existing database first; future backends implement the same ports without Runtime changes.
4. `storage/markdown/` is a bidirectional Projection. It imports legacy cards and exports human-readable files, with a journal/recovery protocol for filesystem failures. It is not the primary backend.
5. `query/` owns a standard query plan and Retriever registry: structured filters → exact → lexical → graph → optional semantic → rerank → context packing.
6. `extensions/` is the only supported extension surface for schema fragments, retrievers, validators, projectors, health checks, and lifecycle hooks.
7. `compatibility/v1_2.ts` is the only place allowed to translate legacy manifests, Card-shaped APIs, old CLI JSON, and Markdown-backed projects into the new model.

## Transaction contract

Backend transactions atomically cover record writes, event append, relation updates, and search-index updates. Cross-filesystem projection is coordinated by a durable projection journal and recovery state; pmem must never claim database/filesystem ACID when only SQLite can roll back. A Runtime write is successful only after the canonical transaction commits; projection failures remain explicit, recoverable health state.

## Compatibility contract

Existing 1.2 projects load without manual bulk card edits. Legacy `manifest.yml`, `.pmem/**/*.md`, and SQLite databases are imported or upgraded through the compatibility adapter. Existing `Pmem.open({ root })`, CLI commands, JSON envelopes, deterministic retrieval, MCP security, and optional semantic fallback remain usable. No internal compatibility type is allowed to leak into new Runtime code.

## Explicit removals from the Runtime

- hard-coded domain/preset decisions;
- implicit Git-branch dependency;
- `DurableFormat = 'markdown'` as a Runtime truth;
- direct SQLite schema creation and table queries;
- command-owned cross-module write transactions;
- domain-specific query channel conditionals.

Git, Markdown, SQLite, and the current semantic companion remain supported as default implementations or integrations where the relevant adapter owns them.

## Release invariant

Every 1.3.0 PR must belong to this final architecture, have a real caller, be independently runnable, preserve old tests, and avoid an interface explicitly marked for later replacement.
