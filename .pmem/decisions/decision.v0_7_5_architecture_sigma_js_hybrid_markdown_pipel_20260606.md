---
id: decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
type: decision
title: "Deferred Web UI Architecture: Sigma.js + Hybrid Markdown Pipeline"
status: deferred
tags: [architecture, sigma-js, markdown, frontend, web-ui, deferred]
created: "2026-06-06"
updated: "2026-06-26T12:25:00.000Z"
token_policy: relaxed
source_files:
  - src/core/db.ts
  - src/core/manifest.ts
  - src/core/fs.ts
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - feature.v0_7_5_graph_visualization_20260606
  - decision.v0_7_5_scope_read_only_single_project_localhost_20260606
  - decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
last_verified: "2026-07-02T21:07:09.089Z"
---
# Deferred Web UI Architecture: Sigma.js + Hybrid Markdown Pipeline

## Current Status

This architecture is preserved as a candidate for a future human-facing graph UI. It is not the active v0.7.5 architecture after the 2026-06-26 Project RAG OS repositioning.

## Decision

If the deferred web UI is resumed, it should use two specific, non-default choices unless a new decision supersedes this card:

1. **Graph rendering: Sigma.js (WebGL) + vanilla TypeScript, no React.** Bundle lands in `dist/web/`, shipped with the existing `pmem-ai` npm package via the `files` field.
2. **Markdown rendering: a hybrid pipeline.**
   - **Server side** (Node, in the new `pmem serve` HTTP layer): parse frontmatter with `js-yaml` (already a pmem dependency), and pre-resolve `[[card-id]]` references in the card body to a list of `wikilinks`. Return a structured card object: `{ id, type, status, ..., frontmatter (object), body_md (raw string), wikilinks (resolved), ... }`.
   - **Client side** (browser): use **`marked`** for Markdown-to-HTML and **`DOMPurify`** for sanitization. A custom `marked` extension rewrites `[[id]]` to `<a class="wikilink" data-card-id="id">…</a>`.
   - **No server-side Markdown rendering to HTML.** Keeps the server thin; lets the client do interactive things (wikilink click handlers, future syntax highlighting) without server work.

## Rationale

### Why Sigma.js (over Cytoscape.js or react-force-graph)

- WebGL → handles ~1000 nodes smoothly. Canvas-based alternatives (Cytoscape) start to choke above a few hundred nodes.
- No required framework. Keeps the frontend stack aligned with pmem's current "zero framework" backend philosophy.
- Smaller runtime than `react-force-graph` (which pulls React + Three.js).
- Known good fit for the "browse a static graph" use case.

### Why hybrid Markdown (over server-rendered HTML or fully client-side)

- **Pre-parsed frontmatter** on the server is unavoidable: the client must not run `js-yaml` (large, was a Node concern).
- **Pre-resolved wikilinks** on the server mean the client knows which `[[id]]` references resolve and which are dangling, **without an extra round-trip** at render time. The card object includes both the raw `body_md` and a `wikilinks: [{target_id, resolved}]` list.
- **Client renders Markdown** because the client must produce interactive `<a>` elements (wikilinks, future code-block copy buttons, future mermaid). Server-rendered HTML would freeze the output as text.
- **DOMPurify is mandatory** in the browser. The CLI is terminal — XSS was never a concern. The web UI changes that, and Markdown→innerHTML is the canonical XSS vector.
- Bundle impact is acceptable: `marked` (~30KB) + `dompurify` (~20KB) ≈ 50KB minified. Worth it for the security + interaction wins.

## API Shape (illustrative)

```ts
// GET /api/cards/:id
{
  id: "module.core",
  type: "module",
  status: "active",
  title: "Core",
  tags: ["core"],
  source_files: ["src/index.ts"],
  depends_on: ["decision.sqlite_runtime"],
  body_md: "## Purpose\n\nMain entry point. See [[module.cli]] for CLI wiring.\n",
  wikilinks: [
    { target_id: "module.cli", resolved: true }
  ],
  updated_at: "2026-06-06T...",
  token_count: 142,
  is_dirty: false,
  related_count: 7
}
```

## Constraints the Code Must Respect

- Frontend **must** import `marked` and `DOMPurify`. Any other Markdown library is out of scope for v0.7.5.
- `dist/web/` is the only frontend build output. No separate `packages/web` repo split in v0.7.5 (deferred; see `decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606`).
- Server must continue to treat Markdown as opaque text — never parse bodies on the server beyond wikilink resolution.
- Wikilink resolution must use the same alias/tag-aware lookup that the existing `pmem ask` uses, so `[[module.cli]]` and the alias `cli` resolve consistently.

## Open Questions

- **Syntax highlighting in code blocks.** `highlight.js` is the lightest option. Defer to a v0.7.5+1 patch unless a card genuinely needs it.
- **Mermaid diagrams.** Not in v0.7.5.
- **Image references** (`![](./x.png)`) — resolve to nothing in v0.7.5; warn or silently ignore. No file:// serving.
