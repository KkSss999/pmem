---
id: module.cli_runtime_20260602
type: module
title: "CLI Runtime"
status: active
tags: [cli, commands, runtime]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/index.ts
  - src/commands/init.ts
  - src/commands/new.ts
  - src/commands/verify.ts
  - src/commands/rebuild.ts
depends_on: []
related_to:
  - module.manifest_runtime_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
last_verified: "2026-07-02T21:15:37.370Z"
---
# CLI Runtime

## Purpose

The CLI runtime owns command registration, argument parsing, command dispatch, and user-visible command behavior for pmem.

## Current Shape

- Entry point: `src/index.ts`
- Commands live under `src/commands/`
- Built output is `dist/index.js`, which is also the package binary target.
- Tests currently use both direct TypeScript tests and CLI-level subprocess tests against `dist/index.js`.

## Important Commands

- `init`: creates `.pmem`, manifest, directories, integration templates, and first memory files.
- `new`: creates markdown card skeletons from manifest-resolved card types and directories.
- `rebuild`: rebuilds SQLite indexes from markdown cards.
- `verify`: checks manifest/card/index consistency.
- `recall` / `ask`: restore and search project memory.
- `update` / `distill`: maintain and consolidate memory.

## Current v0.7.0 Focus

Phase 1 accepted `pmem new` runtime type resolution. `new.ts` now validates against `resolveConfig(manifest).creatable_types`, not a hardcoded type list.

Phase 2 moves `init` toward domain presets: `--domain software|novel|research`, manifest schema emission, and directory/glob generation from `type_dirs`.

## Review Notes

CLI tests that spawn `node dist/index.js` are realistic, but they depend on `npm run build` having produced current dist files. Keep this in mind when reviewing test claims.
