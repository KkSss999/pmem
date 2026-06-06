---
id: trace.v0_7_5_design_discussion_web_visualization_mcp_20260606
type: trace
title: "v0.7.5 Design Discussion: Web Visualization + MCP"
status: draft
tags: [v0.7.5, design, trace, visualization, mcp, pmem-rt]
created: "2026-06-06"
token_policy: relaxed
source_files: []
depends_on: []
related_to:
  - feature.v0_7_5_graph_visualization_20260606
  - decision.v0_7_5_scope_read_only_single_project_localhost_20260606
  - decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
  - decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
  - task.post_v0_7_optimization_roadmap_20260602
---
# v0.7.5 Design Discussion: Web Visualization + MCP

## What Changed

Captured the v0.7.5 design discussion on 2026-06-06 in which the project lead re-scoped the web visualization work from v0.8.0 to the v0.7.5 closeout target, and explicitly deferred MCP / `pmem-rt` to a post-v0.7.5 milestone.

## Context (entering the discussion)

- Current version: `pmem-ai@0.7.1` (per `package.json` and `.pmem/state.md`).
- `task.post_v0_7_optimization_roadmap_20260602` had placed the web visualization at v0.8.0 and MCP/`pmem-rt` at v0.9.0.
- The user asked: "下一步主要是想把它做成web可视化，可以看到使用pmem项目的全部图记忆，然后集成好MCP，你有什么想法？" (What's the next step to make pmem web-visualizable so users can see the full graph memory of projects, and integrate MCP well?)

## Discussion Arc (compressed)

1. **Initial architecture framing**: I proposed a `pmem serve` HTTP server plus a `pmem mcp` stdio server, both reading from a shared `GraphService` that wraps `src/core/db.ts`. Frontend would be Sigma.js with vanilla TypeScript. Reasoning: CLI and server share the same data path, no duplication.

2. **Markdown rendering question**: I had assumed frontend shows `.md` cards as if it were obvious. The project lead surfaced that the `.md` rendering path is a real design choice. Three options were laid out:
   - A. Server renders Markdown to HTML (zero client bundle, weak interactivity)
   - B. Client parses with `marked`+`DOMPurify` (~50KB bundle, strong interactivity)
   - C. Hybrid — server pre-parses frontmatter + resolves `[[wikilink]]` references, client renders body. **This was the agreed direction.**

3. **Scope clarifications** (via structured questions):
   - Web UI v1: **read-only** (writes stay on `pmem update --confirm`).
   - Service scope: **single project** (no cross-project dashboard).
   - Network: **127.0.0.1 only**, no auth, no LAN exposure in v0.7.5.
   - Graph library: **Sigma.js + vanilla TypeScript** (rejected Cytoscape and react-force-graph with reasons).

4. **Wikilink interaction question**: After the hybrid Markdown pipeline was chosen, the project lead asked how wikilink clicks should behave in the UI. Three options:
   - Pure switch (just navigate)
   - Switch + temporary in/out edge highlight (chosen)
   - Switch + full sub-graph (only show N hops)
   The project lead chose **"switch + temporary highlight context"** as the right balance between signal and disruption.

5. **MCP repositioning**: I framed MCP as a P2 follow-up after P1 (visualization). The project lead then **redefined MCP's purpose**: it's not a P2 polish item, it's a **runtime** — pmem as a sidecar runtime for user agent projects. Each agent (Claude Code, Codex, Cursor) running in a user's project would spawn `pmem mcp` as a stdio subprocess, and pmem would be a low-latency memory backend inside the agent's tool loop.

6. **`pmem-rt` repository question**: Following the runtime repositioning, I floated splitting a separate `pmem-rt` package/repo. The project lead's question: should this be a new project?

7. **Course correction (the decision recorded here)**: The project lead corrected the framing:
   - "v0.7.5 的结项目标设置为可视化全面 ready" (set v0.7.5's closeout target to "visualization fully ready")
   - "再考虑后续的 rt" (consider `rt` subsequently)
   - "你现在就搞反了" (you've got it backwards now)
   Translation: visualization is the **immediate v0.7.5 closeout target**. MCP/`pmem-rt` is **post-v0.7.5** work, not a sibling track, not absorbed into v0.7.5.

## Decisions Made

| # | Decision | Card |
|---|---|---|
| 1 | Web UI v0.7.5 closeout = visualization fully ready | `feature.v0_7_5_graph_visualization_20260606` |
| 2 | Read-only, single project, localhost only | `decision.v0_7_5_scope_read_only_single_project_localhost_20260606` |
| 3 | Sigma.js + hybrid Markdown (server pre-parses frontmatter+wikilinks, client uses marked+DOMPurify) | `decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606` |
| 4 | Wikilink click → switch panel + temporary in/out edge highlight | `decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606` |
| 5 | MCP / `pmem-rt` **explicitly deferred** to post-v0.7.5 | `decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606` |

## Open Questions Captured (for follow-up)

- Default port for `pmem serve` (current guess: `7321`).
- Whether v0.7.5 ships web assets inside `pmem-ai` or in a separate `pmem-web` package. Current plan: inside `pmem-ai` for v0.7.5.
- Highlight persistence: "remain until next selection" is the default. Confirm during P1 implementation.
- v0.7.2, 0.7.3, 0.7.4 intermediate releases — **not scoped by this discussion**. If the project lead wants intermediate releases between 0.7.1 and 0.7.5, they should be added as separate `feature` or `task` cards.

## What NOT To Do (anti-patterns to avoid)

- Do not add `pmem mcp` or any MCP plumbing in v0.7.5.
- Do not add `pmem install --mcp` flag in v0.7.5.
- Do not introduce `pmem-rt` directory, package, or repository in v0.7.5.
- Do not bundle MCP-related dependencies (`@modelcontextprotocol/sdk`, etc.) in v0.7.5's `package.json`.
- Do not register MCP server entries in any agent's config as part of v0.7.5 release.

## Next

Begin v0.7.5 P1 implementation:

1. `pmem serve` subcommand in `src/commands/serve.ts`.
2. Thin HTTP layer routing to a `GraphService` (initial version: just wraps `src/core/db.ts` reads).
3. Minimum-viable Sigma.js frontend in `dist/web/`, served as static assets.
4. E2E: `pmem serve` starts, `GET /api/cards/:id` returns structured JSON, browser renders graph + card panel.
5. Run `pmem verify` and an integration test that the new card content passes through the `verify` flow.
