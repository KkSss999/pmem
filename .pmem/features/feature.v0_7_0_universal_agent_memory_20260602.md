---
id: feature.v0_7_0_universal_agent_memory_20260602
type: feature
title: "v0.7.0 Universal Agent Memory"
status: completed
tags: [v0.7.0, universal-memory, domain-presets, dogfooding]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - docs/v0.7.0 pre-design.md
  - src/types.ts
  - src/core/manifest.ts
  - src/commands/init.ts
  - src/commands/new.ts
  - src/commands/recall.ts
depends_on: []
related_to:
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
  - task.v0_7_0_phase_2_domain_presets_20260602
  - decision.v0_7_0_zero_migration_compatibility_20260602
---
# v0.7.0 Universal Agent Memory

## Goal

Make pmem useful for any agent project, not only software projects: writing, research, screenplay, course design, and other domains should use the same `recall` / `ask` / `update` workflow with domain-specific card types.

## Accepted Direction

- Keep manifest `schema_version` at `0.3`.
- Add optional manifest schema fields with v0.6.4 fallbacks.
- Resolve config at runtime and do not mutate old manifests.
- Support domain presets through `pmem init --domain`.
- Preserve old software project behavior without migration.

## Phase Status

- Phase 1 Core Unblock: accepted at commit `89b2b75` after revised 3 added CLI-focused `pmem new` tests.
- Phase 2 Domain Presets: accepted after review round 3.
- Phase 3 Friction Polish: accepted after review round 2.
- Phase 4 Discover Disable: accepted after review round 2.

## Completion

v0.7.0 development goals are complete. Remaining work is release readiness rather than feature implementation.

## Phase 1 Acceptance Summary

Phase 1 accepted:

- `NodeType` relaxed to string.
- `resolveConfig()` and `renderIdPattern()` added.
- `pmem new` reads creatable types and directories from resolved manifest config.
- `verify` supports `{types}` id pattern.
- `distill` reads merge target types from `distill.merge_target_types`.
- CLI-focused tests now cover old-project rejection and custom `character` creation.

## Product Principle

Domain presets are initialization templates, not permanent hardcoded behavior. Users can manually edit manifest schema fields to customize project memory.
