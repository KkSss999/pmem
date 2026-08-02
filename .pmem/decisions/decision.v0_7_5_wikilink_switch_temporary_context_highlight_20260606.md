---
id: decision.v0_7_5_wikilink_switch_temporary_context_highlight_20260606
type: decision
title: "Deferred Web UI Wikilink Interaction"
status: deferred
tags: [wikilink, interaction, graph, web-ui, deferred]
created: "2026-06-06"
updated: "2026-06-26T12:25:00.000Z"
source_files: []
depends_on: []
related_to:
  - decision.project_rag_os_positioning_20260626
  - feature.v0_7_5_graph_visualization_20260606
  - decision.v0_7_5_architecture_sigma_js_hybrid_markdown_pipel_20260606
last_verified: "2026-06-26T12:25:00.000Z"
classification: decision
trust_label: user_confirmed
sensitivity: internal
---
# Deferred Web UI Wikilink Interaction

## Current Status

This interaction decision is deferred with the Web UI. It remains useful design material, but it is not part of the active v0.7.5 milestone.

## Decision

If the deferred graph UI is resumed, clicking a wikilink in a rendered card body should trigger two actions in this order:

1. **Switch**: The side panel navigates to the target card (replaces current card content). The graph centers on the target node.
2. **Highlight context**: The target's **in-edges and out-edges** are visually emphasized (color, weight, or glow). All other nodes are dimmed (low opacity). Edge labels/types remain visible for the highlighted subset.

The highlight remains active until the user clicks a different node, a different wikilink, or an explicit "Reset view" control. No auto-timeout.

## Rationale

- The "switch" half is table stakes — wikilinks that don't navigate are just colored text.
- "Highlight context" gives the user the "身临其境" of seeing who references the current card and what it references, without forcing a sub-graph rebuild. Reuses the existing `edges` table; no new data needed.
- "Permanent until next selection" (vs. auto-clear) matches mental model: a click is a deliberate "focus on this thing" action. Auto-clearing creates surprise ("why did the graph change?").

## Alternatives Considered

- **Switch only (no highlight).** Rejected — too quiet, user doesn't get spatial sense of the new card's place in the graph.
- **Switch + full sub-graph (show only N hops, hide everything else).** Rejected as default — too aggressive. User loses peripheral awareness of the rest of the project. Can be added as an opt-in toggle later.
- **Auto-clear highlight after 5 seconds.** Rejected — surprising behavior. Re-click re-highlights trivially.

## Implementation Constraints

- Highlight must be visually distinct but reversible. No node should be **removed** from the graph during highlight; only dimmed or restyled.
- The "in-edges" / "out-edges" must come from the existing `edges` table — no new SQLite queries with a different shape, just `getEdgesForCard(targetId)`.
- Wikilinks that fail to resolve (deleted card, typo) must be **visually distinct** in the rendered body (e.g. red dashed underline) and clicking them should not navigate, only show a brief message: "Card not found".
- Highlight must not interfere with the existing `pmem related` CLI semantics. The CLI still returns the full neighbor set; the UI just visually emphasizes a subset of the same data.

## Future Hooks (out of scope, but design leaves room)

- A "Pin" toggle on a card to keep its highlight visible while the user navigates to other cards.
- A "Show only N-hop neighborhood" mode that builds on top of the highlight logic.
- "Cite" / "Mention" edge type special-casing (so `source: mention` edges are styled differently from `source: explicit`).
