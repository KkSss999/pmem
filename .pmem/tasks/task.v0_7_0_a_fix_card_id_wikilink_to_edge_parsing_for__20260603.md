---
id: task.v0_7_0_a_fix_card_id_wikilink_to_edge_parsing_for__20260603
type: task
title: "v0.7.0-a: Fix [[card-id]] wikilink-to-edge parsing for non-software domains"
status: completed
tags: [bugfix, graph, wikilink, v0.7.0-a, discover-gap, resolved]
created: "2026-06-03"
updated: "2026-06-04T00:00:00Z"
source_files:
  - src/commands/rebuild.ts
  - src/core/db.ts
  - src/types.ts
depends_on: []
related_to:
  - decision.implement_card_id_body_scan_edge_generation_during_20260603
  - feature.v0_7_0_universal_agent_memory_20260602
  - module.cli_runtime_20260602
last_verified: "2026-07-02T21:07:09.090Z"
---

## GitHub Issue

[#3] [v0.7] Graph: [[card-id]] refs do not generate edges — novel domain graphs permanently empty

## Root Cause

The `mention` edge source type exists in the type system (`src/types.ts:482`) and is accepted by all edge-consuming commands, but **zero code** creates `source: 'mention'` edges. Card bodies are never scanned for `[[card-id]]` wikilink patterns during `pmem rebuild`.

For non-software domains (novel, research) where `discover.enabled = false`, this means the graph is permanently empty — `[[card-id]]` in prose is the only natural way to declare inter-card relationships, but it doesn't feed the graph.

## Scope

### Primary fix (Issue #1 - High)
Add `[[card-id]]` → edge parsing to `pmem rebuild`:
1. Scan card body for `[[<card-id>]]` patterns
2. Resolve each reference against the cards table
3. Insert edges with `type='references'`, `source='mention'`, `confidence=1.0`

### Secondary fixes (Issues #2-#4)
- Issue #2 (Medium): Preserve `source='explicit'` manual edges during `--full` rebuild
- Issue #3 (Low): Fix rebuild summary to count actual edges from DB, not just legacy graph.json
- Issue #4 (Low): Per-card-type `warn_when_related_count_gt` thresholds

## Files to Modify

| File | Change |
|------|--------|
| `src/commands/rebuild.ts` | Add `extractWikilinks()` + mention edge insertion in per-card loop |
| `src/core/db.ts` | Add `deleteMentionEdges()` for cleanup before re-insertion |
| `src/types.ts` | Add `'references'` to EdgeType if needed |

## Verification

- Unit test: `extractWikilinks()` correctly parses `[[id]]` patterns
- Integration test: novel domain with `[[card-id]]` in body → `pmem rebuild` → `pmem related` returns edges
- E2E test: create novel project, add cards with wikilinks, verify graph non-empty

## Version

Target: v0.7.0-a (patch on v0.7.0)
