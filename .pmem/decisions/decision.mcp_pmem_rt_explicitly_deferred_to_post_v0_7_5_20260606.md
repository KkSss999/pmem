---
id: decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
type: decision
title: "MCP / pmem-rt Explicitly Deferred to Post-v0.7.5"
status: active
tags: [v0.7.5, mcp, pmem-rt, deferred, runtime]
created: "2026-06-06"
source_files: []
depends_on: []
related_to:
  - feature.v0_7_5_graph_visualization_20260606
---
# MCP / pmem-rt Explicitly Deferred to Post-v0.7.5

## Decision

The v0.7.5 milestone does **not** ship MCP server support, a `pmem-rt` sub-package, or a separate `pmem-rt` repository. All three are explicitly **post-v0.7.5** work. Visualization (the web UI) is the v0.7.5 closeout target; MCP/rt is the next milestone's concern.

## Why This Decision Exists

During the v0.7.5 design discussion (2026-06-06, see `trace.v0_7_5_design_discussion_20260606`), the conversation drifted toward:

- Whether MCP server support belongs in v0.7.5 alongside the web UI.
- Whether the MCP runtime should be split into a separate `pmem-rt` npm package or repository.
- How `pmem install --mcp --claude` would auto-register an MCP server entry.

The project lead explicitly redirected: **v0.7.5 is visualization only. Stop scoping v0.7.5 to include MCP, and stop planning the `pmem-rt` split yet.** This card exists so that future sessions (and future agents) do not re-litigate the question, and do not silently start MCP work under the v0.7.5 umbrella.

## Rationale (for the Deferral)

- **MCP is not on the v0.7.5 critical path.** The "visualization fully ready" closeout is achievable without MCP. Adding MCP doubles the API surface, the install flow, and the testing matrix.
- **MCP and `pmem-rt` raise new questions that deserve their own design pass.** Repository split (separate repo vs monorepo workspaces), tool surface (4 tools? 6? 8?), stdio vs HTTP transport, install registration mechanics — these are independent decisions that should be made deliberately, not absorbed into the v0.7.5 design.
- **Risk of scope creep.** v0.7.5 is the next shippable milestone. Mixing in MCP makes it a moving target.

## What Post-v0.7.5 Means

When v0.7.5 ships and the visualization is validated, the next milestone (likely v0.8.0 or a similar post-0.7.5 release) can start a fresh design discussion for MCP / pmem-rt. At that point, this card should be either:

- **Superseded** by a new `feature.mcp_runtime_v0_8` card with its own scope, OR
- **Reaffirmed** if the project has decided to drop MCP entirely (e.g. if user feedback shows agents don't actually need it).

## Forbidden Patterns (until the deferral is lifted)

- Do not add a `pmem mcp` subcommand in v0.7.5.
- Do not add a `pmem install --mcp` flag in v0.7.5.
- Do not introduce a `pmem-rt` directory, package, or repository in v0.7.5.
- Do not pull `@modelcontextprotocol/sdk` or any MCP-specific dependency into `package.json` in v0.7.5.
- Do not register an MCP server entry in any agent's config as part of v0.7.5 release.

## What IS Allowed (still part of v0.7.5)

- The `pmem serve` web server, the Sigma.js frontend, the hybrid Markdown pipeline — all in scope.
- The `pmem install --skills` flow, which copies SKILL.md to agent skill directories. This is **not** MCP; it is a static-file install. (No change to the existing behavior.)
