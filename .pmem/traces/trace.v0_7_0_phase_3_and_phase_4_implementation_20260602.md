---
id: trace.v0_7_0_phase_3_and_phase_4_implementation_20260602
type: trace
title: "v0.7.0 Phase 3 and Phase 4 implementation"
status: draft
tags: [universal-memory, presets]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - src/types.ts
  - src/commands/init.ts
  - src/commands/rebuild.ts
  - src/commands/recall.ts
  - src/commands/status.ts
  - src/core/discover/index.ts
  - package.json
related:
  - feature.v0_7_0_universal_agent_memory_20260602
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
---
# v0.7.0 Phase 3 and Phase 4 implementation

Completed Phase 3 Friction Polish and Phase 4 Discover Default Disable.

## Key Changes
1. **Recall**: Dynamically query `foundational_types` from the manifest resolved config. Populated both `active_foundation` (new) and `active_modules` (compatibility fallback) JSON outputs.
2. **Status**: Generalize scanner settings to parse skips from `change_detection.skip_dirs` and check card directories from resolved config `type_dirs`. Prevented SQLite internal files from producing status stale changes.
3. **Ask/Graph/Rebuild**: Dynamic evidence mapping using resolved `config.evidence_types` and custom file scanning from `source_of_truth.card_globs`.
4. **Ignores/Skills**: Created domain-neutral task skill and integration templates.
5. **Discover**: Early exit with 0 status code and json response if `discover.enabled` is false.

