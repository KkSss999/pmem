---
id: decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
type: decision
title: "MCP / pmem-rt Remains Deferred"
status: active
tags: [mcp, pmem-rt, deferred, runtime, project-rag-os]
created: "2026-06-06"
updated: "2026-06-26T12:25:00.000Z"
source_files: []
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - feature.v0_8_hybrid_recall_engine_20260626
  - feature.v0_7_5_graph_visualization_20260606
  - decision.pmem_rt_v1_thin_mcp_adapter_20260606
last_verified: "2026-06-26T12:25:00.000Z"
---
# MCP / pmem-rt Remains Deferred

## Current Status

This deferral remains active, but the rationale has changed. MCP / `pmem-rt` should wait until the Project RAG OS read/write model and v0.8 Hybrid Recall Engine architecture are clearer. It is no longer blocked behind the old v0.7.5 Web UI closeout.

## Decision

Do not ship MCP server support, a `pmem-rt` sub-package, or a separate `pmem-rt` repository until pmem has a clearer Project RAG OS contract for recall, evidence, lifecycle writes, and memory verification.

## Why This Decision Exists

During the v0.7.5 design discussion (2026-06-06, see `trace.v0_7_5_design_discussion_20260606`), the conversation drifted toward:

- Whether MCP server support belongs in v0.7.5 alongside the web UI.
- Whether the MCP runtime should be split into a separate `pmem-rt` npm package or repository.
- How `pmem install --mcp --claude` would auto-register an MCP server entry.

The original project-lead redirect was: keep MCP out of the near-term milestone and stop planning the `pmem-rt` split before the core product shape is stable. The 2026-06-26 repositioning updates that rationale: MCP should wait for the v0.8 Hybrid Recall Engine and Project RAG OS contract, not for the old Web UI plan.

## Rationale (for the Deferral)

- **MCP is not on the retrieval critical path.** Adding MCP before v0.8 recall architecture is settled would double the API surface, install flow, and test matrix while the underlying memory contract is still moving.
- **MCP and `pmem-rt` raise new questions that deserve their own design pass.** Repository split (separate repo vs monorepo workspaces), tool surface (4 tools? 6? 8?), stdio vs HTTP transport, install registration mechanics — these are independent decisions that should be made deliberately, not absorbed into the v0.7.5 design.
- **Risk of scope creep.** Mixing MCP into v0.8 retrieval work would make the next architecture milestone a moving target.

## What Deferred Means

After the v0.8 Hybrid Recall Engine architecture and Project RAG OS CRUD model are clear, a fresh design discussion can decide whether MCP / pmem-rt is still needed. At that point, this card should be either:

- **Superseded** by a new `feature.mcp_runtime_v0_8` card with its own scope, OR
- **Reaffirmed** if the project has decided to drop MCP entirely (e.g. if user feedback shows agents don't actually need it).

## Forbidden Patterns (until the deferral is lifted)

- Do not add a `pmem mcp` subcommand before a new MCP architecture decision.
- Do not add a `pmem install --mcp` flag before a new MCP architecture decision.
- Do not introduce a `pmem-rt` directory, package, or repository before a new MCP architecture decision.
- Do not add MCP-specific dependencies as part of v0.8 retrieval work.
- Do not register an MCP server entry in any agent's config as part of retrieval or skill-install work.

## What IS Allowed

- Retrieval architecture, context packing, evidence scoring, and memory lifecycle design.
- The `pmem install --skills` flow, which copies SKILL.md to agent skill directories. This is **not** MCP; it is a static-file install.
