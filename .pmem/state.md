# Project State

## Overall Status: v0.7.1 shipped; v0.7.5 design locked; v0.7.5 P1 implementation not yet started.

## Modules
| Module | Status | Last Updated |
|--------|--------|--------------|
| module.cli_runtime_20260602 | active | 2026-06-03 |
| module.manifest_runtime_20260602 | active | 2026-06-03 |

## Active Tasks
- task.v0_7_0_phase_2_domain_presets_20260602
- task.post_v0_7_optimization_roadmap_20260602 (now scoped to v0.7.5)

## Active Features (in design)
- feature.v0_7_5_graph_visualization_20260606 (status: draft → in_progress when P1 starts)

## Recent Changes
- 2026-06-06: Recorded v0.7.5 design discussion as memory cards.
  - Re-scoped visualization from v0.8.0 → v0.7.5 closeout target.
  - Locked the read-only / single-project / localhost scope.
  - Locked Sigma.js + hybrid Markdown (server pre-parses frontmatter + wikilinks, client uses `marked` + `DOMPurify`).
  - Locked wikilink click behavior: switch panel + temporary in/out edge highlight.
  - Explicitly deferred MCP / `pmem-rt` to post-v0.7.5 (not absorbed into v0.7.5).
  - New cards: 1 feature, 4 decisions, 1 trace. Updated 1 task.

## Recent Changes (v0.7.1)
- Updated program version and template versions to `0.7.1`.
- Implemented `pmem sync` shortcut command, `pmem verify --fix-stale` auto-fix option, and flexible token policy checking.
- Updated project README and agent skills documentation to cover v0.7.1 features.
- Verified all unit, integration, and E2E sync-flow tests pass successfully.
