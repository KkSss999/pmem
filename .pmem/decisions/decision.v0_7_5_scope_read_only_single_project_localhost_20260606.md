---
id: decision.v0_7_5_scope_read_only_single_project_localhost_20260606
type: decision
title: "Deferred Web UI Scope: Read-Only, Single Project, Localhost"
status: deferred
tags: [scope, read-only, localhost, web-ui, deferred]
created: "2026-06-06"
updated: "2026-06-26T12:25:00.000Z"
source_files:
  - .pmem/features/feature.v0_7_5_graph_visualization_20260606.md
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - feature.v0_7_5_graph_visualization_20260606
  - decision.mcp_pmem_rt_explicitly_deferred_to_post_v0_7_5_20260606
last_verified: "2026-06-26T12:19:26.213Z"
---
# Deferred Web UI Scope: Read-Only, Single Project, Localhost

## Current Status

This decision is deferred with the Web UI feature. It remains the preferred boundary if/when pmem implements a local graph/browser interface, but it no longer defines the v0.7.5 milestone.

## Decision

The deferred visualization scope has three explicit boundaries:

1. **Read-only.** The web UI can browse, search, filter, and inspect cards. It cannot create, edit, or delete cards. All writes continue to flow through `pmem update --confirm` and other CLI commands, preserving the confirmation-first product principle.
2. **Single project.** `pmem serve` serves the `.pmem/` directory found in its current working directory. There is no project switcher, no multi-project aggregation, no cross-project dashboard in v0.7.5.
3. **Localhost only.** The HTTP server binds to `127.0.0.1`. There is no `--host 0.0.0.0` flag, no authentication, no token. Remote/LAN access is a later milestone.

## Rationale

- **Read-only** keeps the surface area small. Replicating the CLI's `pmem update --confirm` flow in a browser (with diff preview, multi-step confirmation, write-through to SQLite) is a substantial effort on its own and is not on the critical path for "users can see their memory graph".
- **Single project** avoids the data model question of how to represent "all my projects" — a question that becomes real only once users have multiple pmem projects and want to switch. Solve it when there's a real user need, not preemptively.
- **Localhost** removes a whole class of security and ops concerns (auth, CORS, deployment, port conflicts) for v0.7.5. The user runs `pmem serve` on their own machine, opens a browser tab, done. No firewall, no token to manage, no "what port is free" question.

## Alternatives Considered

- **Allow in-UI writes for `trace` cards only.** Useful for "while reviewing, jot a quick observation". Deferred to v0.7.5 P4 if needed; not in the closeout scope.
- **Multi-project switcher from day one.** Rejected: doubles the routing/state complexity for a feature that not all users need.
- **Bind to `0.0.0.0` with a generated token.** Rejected for v0.7.5; revisit if user feedback shows LAN access is a common need.

## Operating Note

If any of these three boundaries starts to feel constraining during development, the right move is to **expand the decision explicitly** with a new `decision` card that records the new boundary, not to silently cross it.
