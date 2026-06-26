---
id: task.post_v0_7_optimization_roadmap_20260602
type: task
title: "Post v0.7 Optimization Roadmap"
status: active
tags: [roadmap, optimization, token-economy, performance, intelligence, visualization]
created: "2026-06-02"
updated: "2026-06-06T00:00:00.000Z"
token_policy: relaxed
source_files:
  - README.md
  - docs/project-roadmap.md
  - skills/pmem/SKILL.md
depends_on: []
related_to:
  - feature.v0_7_0_universal_agent_memory_20260602
  - feature.v0_7_5_graph_visualization_20260606
  - decision.v0_7_5_scope_read_only_single_project_localhost_20260606
  - decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
  - decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
last_verified: "2026-06-26T11:53:06.856Z"
---
# Post v0.7 Optimization Roadmap

## Context

v0.7.0 turns pmem into universal agent memory for software, novel, research, and custom-schema projects. Next question: how cheaply, quickly, intelligently, and visibly can people and agents operate it?

## Optimization Themes

### 1. Token Economy

Highest priority. Keep `recall` budget-controlled, but make output layered:

- Level 0: project one-liner, stage, focus, next step.
- Level 1: summarized `active_foundation` cards.
- Level 2: relevant card summaries for the current query or task.
- Level 3: paths to full cards for on-demand reading.

- `pmem recall --mode brief|normal|deep`.
- `summary` / `compressed_summary` per card.
- `ask` summaries first; raw body only on request.
- Better trace distillation.
- Domain summaries: chapter summaries for novels, source summaries for research.

### 2. Speed

Large `.pmem` projects need better incremental behavior.

- More precise rebuild invalidation based on file hashes and manifest `card_globs`.
- Smarter `status` mtime scanning with fewer full-directory walks.
- Query-result cache keyed by query plus DB/content hash.
- Graph expansion limits that prevent large projects from flooding recall.
- Lazy, domain-aware discover providers.

### 3. Intelligence

Keep intelligence confirmation-first. Avoid hidden automatic memory rewrites.

- `pmem suggest-card` to recommend new card types for changed files or gaps.
- Stronger `update --apply-suggestion` with explicit confirmation.
- Intent-aware `ask` for decisions, risks, characters, claims, evidence, or tasks.
- Domain checks: novel consistency, research claim/source coverage, software changes without matching memory.

### 4. Human Visualization

The next major product surface can be a local UI for humans to inspect project memory.

- `pmem graph-ui` or `pmem serve` local web interface.
- Card list with type/status/tag filters.
- Relationship graph for `depends_on`, `related_to`, source files, and inferred edges.
- Dirty/stale card dashboard.
- Recall preview by budget/mode and Markdown card detail view.
- Buttons for `rebuild`, `verify`, `distill --suggest`, and edge review.

## Suggested Version Path

- v0.7.1: token economy, skill/docs polish, recall modes.
- v0.7.2: smarter `update` and `distill`, still confirmation-first.
- v0.7.5: **local visualization frontend / graph viewer** (re-scoped from v0.8.0 on 2026-06-06). Closeout target: "visualization fully ready" — `pmem serve` opens a browser showing the full graph, with read-only card detail, filters, search, status dashboard, and wikilink navigation. See `feature.v0_7_5_graph_visualization_20260606` and the four `decision.v0_7_5_*` cards for the locked design.
- v0.8.x (post-v0.7.5): MCP / `pmem-rt` runtime direction. **Explicitly deferred** in v0.7.5. See `decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606`. The original positioning for `pmem-rt` is a stdio MCP server that user agents (Claude Code / Codex / Cursor) spawn as a sidecar process against their own project's `.pmem/`, exposing pmem as a low-latency memory backend in the agent's tool loop. This is a fresh design pass for the next milestone.

## v0.7.5 Sub-tasks (added 2026-06-06)

1. Add `pmem serve` subcommand in `src/commands/serve.ts`. Bind to `127.0.0.1`, default port TBD (current candidate: `7321`).
2. Extract a `GraphService` wrapper in `src/server/` that re-exports `related` / `trace` / `ask` / `list_cards` / `get_card` query functions, so CLI commands and the HTTP server share the same data path.
3. Add HTTP routes: `GET /api/graph`, `GET /api/cards/:id`, `GET /api/search?q=`, `GET /api/status`, `GET /api/health`.
4. Add `dist/web/` static frontend: Sigma.js + vanilla TS, `marked` + `DOMPurify`, custom wikilink `marked` extension.
5. E2E test: start `pmem serve`, hit `/api/cards/:id` with `curl`, assert structured JSON, open browser via headless test or manual smoke.
6. Document the new subcommand in `README.md` and `skills/pmem/SKILL.md` (CLI skill only; **do not** touch MCP-related docs).
7. `pmem verify` must pass; new cards must satisfy the existing schema.

## Forbidden in v0.7.5

- Any `pmem mcp` subcommand.
- Any `pmem install --mcp` flag.
- A `pmem-rt` directory, package, or repository.
- `@modelcontextprotocol/sdk` or any MCP-specific dependency in `package.json`.
- Auto-registration of an MCP server entry in any agent config.

## Product Principle

Do not trade trust for cleverness. pmem should get cheaper, faster, and smarter while keeping Markdown cards as source of truth and keeping important writes explicit.
