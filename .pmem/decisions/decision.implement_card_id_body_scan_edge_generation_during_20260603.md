---
id: decision.implement_card_id_body_scan_edge_generation_during_20260603
type: decision
title: "Implement [[card-id]] body-scan edge generation during rebuild"
status: active
tags: [architecture, graph, wikilink, design-decision]
created: "2026-06-03"
source_files:
  - src/commands/rebuild.ts
  - src/core/db.ts
  - src/types.ts
depends_on: []
related_to:
  - task.v0_7_0_a_fix_card_id_wikilink_to_edge_parsing_for__20260603
---

## Decision

Add `[[card-id]]` wikilink body scanning to `pmem rebuild` as the third edge-generation mechanism, producing edges with `source='mention'`, `type='references'`, `confidence=1.0`.

## Architecture

The fix follows the existing rebuild per-card loop pattern:

```
for each card:
  1. Parse frontmatter + body
  2. Upsert card row
  3. Delete old explicit edges → re-insert from frontmatter
  4. 🆕 Delete old mention edges → re-insert from body wikilinks
  5. (inferred edges are managed by discover, untouched here)
```

## Design Choices

### 1. Edge type: `references` 
The word "references" is more descriptive than "related_to" for wikilink-derived edges. The `[[card-id]]` syntax in prose naturally means "this card references that card." If `references` is not already in `EdgeType`, it will be added.

### 2. Edge source: `mention`
Uses the existing-but-unused `'mention'` source type, semantically correct for body-extracted references.

### 3. Confidence: 1.0
Unlike discover's heuristic matches, `[[card-id]]` is an explicit author intention — the equivalent of a deliberate hyperlink. Maximum confidence.

### 4. Regex pattern
`/\[\[([a-z0-9._-]+)\]\]/gi` — matches standard pmem card IDs. Case-insensitive to be forgiving, but resolution against the cards table ensures only valid targets generate edges.

### 5. Cleanup before re-insertion
New function `deleteMentionEdges(db, cardId)` mirrors `deleteExplicitCardEdges()`. This ensures rebuild is idempotent: re-running with the same content produces the same edges.

### 6. Cross-domain applicability
This mechanism works identically across software, novel, research, and custom domains. It fills the gap for non-software domains where `discover` is disabled, but also adds value for software domains (prose references alongside code-import edges).

## What This Does NOT Do

- Does NOT modify `pmem discover` — discover remains software-only
- Does NOT change frontmatter parsing — `depends_on` and `related` still work as before
- Does NOT introduce bidirectional edges — `A [[B]]` creates A→B only
- Does NOT parse wikilinks in frontmatter fields — only body text

## Risks

- **Low**: Large card bodies with many `[[...]]` patterns not intended as card IDs. Mitigation: only generate edges for patterns that resolve to actual card IDs in the cards table.
- **Low**: Performance with very large projects. Mitigation: single-pass regex + batched card ID lookup.
