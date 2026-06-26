---
id: feature.v0_7_5_graph_visualization_20260606
type: feature
title: "Deferred Graph Visualization (Web UI)"
status: deferred
tags: [visualization, web-ui, graph, deferred]
created: "2026-06-06"
updated: "2026-06-26T12:20:00.000Z"
token_policy: relaxed
source_files: []
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - task.post_v0_7_optimization_roadmap_20260602
  - decision.v0_7_5_scope_read_only_single_project_localhost_20260606
  - decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
  - decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
last_verified: "2026-06-26T12:20:00.000Z"
---
# Deferred Graph Visualization (Web UI)

## Current Status

This card is preserved as a future human-inspection direction, but it is no longer the active v0.7.5 milestone boundary. After the 2026-06-26 repositioning, v0.7.5 is treated as the published Context Restoration milestone and v0.8 targets the Hybrid Recall Engine.

The Web UI idea should be reconsidered after the recall/RAG architecture is clearer, because graph visualization is most useful when it can expose real retrieval evidence, freshness, graph expansion, and memory lifecycle state.

## Goal

Make pmem's graph-shaped memory **browsable by humans in a browser**, complementing the agent-facing CLI/recall/ask read path. The original 2026-06-06 proposal targeted a `pmem serve` command that opens a local web UI where the user can see all cards, navigate the relationship graph, and read full Markdown card bodies without going through token budgets or `recall` summaries.

## Why v0.7.5 (not v0.8.0)

Originally placed in v0.8.0 by `task.post_v0_7_optimization_roadmap_20260602`. After design discussion on 2026-06-06, the project lead temporarily re-scoped visualization into the v0.7.x line because it was additive to the existing CLI contract. That milestone boundary was superseded on 2026-06-26 by the Project RAG OS repositioning: v0.7.5 is Context Restoration, v0.8 is Hybrid Recall Engine, and graph visualization is deferred.

## Original Scope

- A new `pmem serve` subcommand that boots an HTTP server on `127.0.0.1` (default port `7321`, TBD) and opens the browser.
- Read-only: no in-UI editing. Writes continue to flow through `pmem update --confirm`. Rationale: confirmation-first is a core product principle, and replicating it in a browser is a separate effort.
- Single project: `pmem serve` serves whichever `.pmem/` lives in the current working directory. Cross-project dashboard is out of scope.
- Localhost only: bind to `127.0.0.1`. LAN/remote access is a later milestone.

## Sub-features

1. **Graph view** — full card set rendered as a force-directed graph. Node color encodes `type`, ring/border encodes `status` (active/draft/archived) and `is_dirty`.
2. **Card detail panel** — selected card's frontmatter + Markdown body rendered in a side panel. Wikilinks (`[[card-id]]`) become clickable and navigate the graph + side panel to the target.
3. **Filters** — by `type`, `status`, `tag`, `has_dirty`, `source_files` substring.
4. **Search** — wraps `pmem ask` semantics; clicking a result focuses the corresponding node.
5. **Status dashboard** — dirty/stale cards surfaced prominently, with `pmem status` numbers shown.

## Out of scope (v0.7.5)

- In-UI editing (cards, frontmatter, edges). Stay on `pmem update` CLI.
- Cross-project aggregation. One project per server instance.
- Authentication, LAN exposure, remote access. Localhost only.
- Vector/embedding-based similarity search. Still deferred.
- WebSocket live updates from external agents. Polling on focus changes is enough for v1.

## Architecture Snapshot

- Backend: a new `pmem serve` subcommand in single-repo form (no monorepo split in v0.7.5). HTTP layer is intentionally thin; data access reuses `src/core/db.ts` and `src/core/manifest.ts` directly. No new abstractions until duplication is observed.
- Graph rendering: **Sigma.js** with WebGL, vanilla TypeScript, no React. Bundle lands in `dist/web/` and is shipped with the npm package via the existing `files` field.
- Markdown rendering: **hybrid pipeline**. Server pre-parses frontmatter (YAML → JSON) and resolves `[[card-id]]` references in card bodies, returning a structured card object. Client uses `marked` + `DOMPurify` to render body Markdown to safe HTML. Wikilinks become `<a class="wikilink" data-card-id="...">` elements.
- Wikilink interaction: clicking a wikilink navigates the side panel to the target card and **temporarily highlights the target's in-edges and out-edges in the graph**, with other nodes dimmed. Restores full graph when a different selection is made.

## Phased Delivery

| Phase | Scope | Notes |
|---|---|---|
| P1 | `pmem serve` HTTP + minimal single-page graph viewer (read-only) | 1–2 weeks |
| P2 | UI polish: filters, search, status dashboard, wikilink navigation | 1 week |
| P3 | Edge review (inferred/explicit), recall preview, embed-friendly tweaks | 1 week |
| P4 | Optional: lightweight in-UI write (e.g. add a `trace` card) | only if needed |

## Open Questions

- Default port (`7321` is a guess; needs validation against IANA-registered / common local-dev ports).
- Whether to ship a separate `pmem-web` npm package or keep web assets inside `pmem-ai`. Current plan: keep inside `pmem-ai` for v0.7.5 to avoid premature splitting.
- Highlight persistence: should the wikilink highlight remain until the user clicks elsewhere, or auto-clear after N seconds? Default to "remain until next selection".

## Related

- `decision.v0_7_5_scope_readonly_local_20260606` — scope decisions
- `decision.v0_7_5_architecture_sigma_markdown_20260606` — stack decisions
- `decision.v0_7_5_wikilink_highlight_context_20260606` — interaction decisions
- `decision.mcp_rt_post_v0_7_5_20260606` — explicit deferral of pmem-rt/MCP
- `task.post_v0_7_optimization_roadmap_20260602` — original parent roadmap task, will be updated to reflect re-scoping
- `trace.v0_7_5_design_discussion_20260606` — the conversation that produced this feature definition
