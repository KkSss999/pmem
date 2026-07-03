---
id: decision.v0_7_0_zero_migration_compatibility_20260602
type: decision
title: "v0.7.0 Zero Migration Compatibility"
status: active
tags: [compatibility, migration, v0.7.0, manifest]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - docs/v0.7.0 pre-design.md
  - src/core/manifest.ts
  - src/commands/new.ts
depends_on: []
related_to:
  - module.manifest_runtime_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
last_verified: "2026-07-02T20:48:42.244Z"
---
# v0.7.0 Zero Migration Compatibility

## Decision

v0.7.0 must not require migration for existing v0.6.x projects.

## Rationale

Existing software projects should continue working immediately after upgrading the CLI. Optional schema fields enable new domains, but old manifests remain valid and unchanged.

## Consequences

- `schema.*` fields are optional.
- `resolveConfig()` computes missing defaults in memory.
- Read operations must not inject schema fields into old manifests.
- `schema_version` remains `0.3`.
- `pmem migrate` is not required for v0.7.0 universal memory.

## Concrete Compatibility Rules

- Old projects with no `schema.card_types` use the v0.6.4 id whitelist for validation and indexing.
- Old projects with no `schema.card_types` use v0.6.4 `pmem new` creatable types only: `decision/module/task/feature/risk/trace`.
- Old `card_policy.id_pattern` without `{types}` remains valid.
- New v0.7 projects can use `{types}` in `card_policy.id_pattern`.

## Review History

Phase 1 initially widened old-project creatable types by using `card_types` directly. CTO review rejected that. Revised 2 introduced `creatable_types`; revised 3 added CLI-level tests and was accepted.
