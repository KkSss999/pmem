---
id: module.manifest_runtime_20260602
type: module
title: "Manifest Runtime"
status: active
tags: [manifest, schema, compatibility, resolved-config]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/core/manifest.ts
  - src/types.ts
  - src/commands/new.ts
  - src/commands/verify.ts
  - docs/v0.7.0 pre-design.md
depends_on: []
related_to:
  - decision.v0_7_0_zero_migration_compatibility_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
---
# Manifest Runtime

## Purpose

The manifest runtime resolves project configuration from `.pmem/manifest.yml` while preserving backward compatibility for old v0.6.x projects.

## Current v0.7.0 Contract

- `NodeType` is now `string`; runtime validation comes from manifest config.
- `resolveConfig(manifest)` computes card types, type directories, foundational types, evidence types, default type, merge targets, and creatable types.
- The resolved config is pure and must not write back to manifest files.
- Old projects without `schema.card_types` fall back to v0.6.4-compatible defaults.
- New domain projects can declare `schema.card_types`, `schema.type_dirs`, `schema.foundational_types`, `schema.evidence_types`, and `schema.default_type`.

## Compatibility Boundary

Old v0.6.x projects must work without migration. In particular, `pmem new` for old projects must only accept the original v0.6.4 creatable types:

- decision
- module
- task
- feature
- risk
- trace

Types present only in the historical id whitelist, such as `project`, `assumption`, `resource`, and `integration`, are not creatable for old projects.

## Current Risk

When a new `software` domain manifest explicitly writes `schema.card_types`, it follows the custom-schema path. Review whether `project` should be creatable in software-domain new projects or whether software preset needs an explicit creatable policy. Phase 1 accepted old-project behavior, not necessarily new software-domain behavior.
