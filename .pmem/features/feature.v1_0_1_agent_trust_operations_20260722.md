---
id: feature.v1_0_1_agent_trust_operations_20260722
type: feature
title: "v1.0.1 Agent-Trust Operations — from memory store to Agent-first operation layer"
status: implemented
tags: [v1.0.1, agent-trust, verify, confidence, classification, supersede, next, distill, done]
created: "2026-07-22"
updated: "2026-07-22T13:00:00.000Z"
last_verified: "2026-07-22T13:00:00.000Z"
source_files:
  - src/types/cards.ts
  - src/core/consistency.ts
  - src/core/query/engine/scoring.ts
  - src/core/format.ts
  - src/core/next.ts
  - src/commands/verify.ts
  - src/commands/context.ts
depends_on:
  - feature.v1_0_agentic_memory_runtime_20260722
  - decision.v1_0_pr_review_fixes_20260722
related_to:
  - feature.v1_1_system_memory_release_20260722
---

# v1.0.1 Agent-Trust Operations

> Based on [[issue #14|https://github.com/KkSss999/pmem/issues/14]]: 从项目记忆仓库升级为 Agent-first 操作层

## Goal

Add trustworthiness, distillation, conflict detection, and execution closure to pmem so it can serve as a long-term viable project memory layer — not just a passive store.

## Scope (v1.0.1)

### 1. Confidence & Freshness Metadata
- Add `confidence?: number` (0–1) to `CardFrontmatter`
- Surface confidence in `pmem verify` output (flag low-confidence cards)
- Surface confidence in `pmem ask` scoring (boost high-confidence cards)
- Existing: `last_verified`, `updated`, TTL freshness

### 2. Decision Superseding
- Add `superseded_by?: string[]` to `CardFrontmatter`
- `pmem verify` detects decisions that reference superseded decisions
- `pmem ask`/`pmem recall` downgrade superseded cards

### 3. Memory Classification
- Add `classification?: 'fact' | 'decision' | 'assumption' | 'plan' | 'risk' | 'question'` to `CardFrontmatter`
- `pmem verify` warns on unclassified cards
- `pmem recall` groups output by classification

### 4. Structured next.md Task Queue
- Add priority (`P0`/`P1`/`P2`), owner, and acceptance criteria to next.md items
- `pmem context` surfaces priority-sorted next steps

### 5. Enhanced pmem verify — Conflict Detection
- Detect cards with overlapping topics but conflicting conclusions
- Detect cards referencing deleted/superseded cards
- Detect stale next steps (no progress after N sessions)

### Deferred to v1.1
- Auto-distill trigger (trace count ≥ N → auto-suggest distill)
- Module boundary contracts
- Doc-pmem sync drift tracking
