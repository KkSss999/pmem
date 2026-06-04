---
id: task.post_v0_7_optimization_roadmap_20260602
type: task
title: "Post v0.7 Optimization Roadmap"
status: active
tags: [roadmap, optimization, token-economy, performance, intelligence, visualization]
created: "2026-06-02"
source_files:
  - README.md
  - docs/project-roadmap.md
  - skills/pmem/SKILL.md
depends_on: []
related_to:
  - feature.v0_7_0_universal_agent_memory_20260602
  - module.cli_runtime_20260602
  - module.manifest_runtime_20260602
last_verified: "2026-06-04T22:03:36.793Z"
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
- v0.8.0: local visualization frontend / graph viewer.
- v0.9.0: optional MCP or agent-server mode after the CLI and local UI are stable.

## Product Principle

Do not trade trust for cleverness. pmem should get cheaper, faster, and smarter while keeping Markdown cards as source of truth and keeping important writes explicit.
