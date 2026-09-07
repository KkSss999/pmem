---
id: decision.portfolio_first_readme_presentation_20260907
type: decision
title: "Portfolio-first README presentation"
status: active
classification: decision
trust_label: user_confirmed
sensitivity: internal
tags: [readme, portfolio, developer-experience, agent-infrastructure]
created: "2026-09-07"
source_files: [README.md, package.json, assets/pmem-session-demo.gif, assets/pmem-architecture.svg, scripts/generate-readme-demo.sh, scripts/generate-readme-demo.mjs]
depends_on: [decision.pmem_two_layer_architecture_20260722, decision.structure_first_hybrid_recall_20260626, decision.v1_3_2_semantic_distribution_experience_20260803]
related: [decision.sqlite_first_semantic_layer_20260626, decision.v1_3_0_runtime_first_schema_driven_backend_pluggable_20260802]
last_verified: "2026-09-07T13:15:06.612Z"
---
# Portfolio-first README presentation

## Decision

Present the repository as an engineering portfolio for an Agentic Memory
Runtime while preserving the full operational reference in the README. The
first screen must make the problem, the short path to value, and the product
shape understandable without requiring a reader to scan CLI details.

## Rationale

The project already demonstrates meaningful engineering depth—local project
memory, deterministic hybrid retrieval, optional semantic retrieval,
ContextPack, lifecycle operations, MCP, and an SDK—but its former README led
with an exhaustive reference. A hiring manager or framework author needs to
understand the system-level problem and the design trade-offs first.

## Presentation contract

- Lead with a concise product promise, supported interfaces, and install path.
- Include a 20-second representative terminal flow and an accessible SVG
  architecture diagram stored in-repository.
- Explain inspectability, rebuildable runtime indexes, hybrid retrieval, shared
  CLI/MCP/SDK contracts, and recoverable lifecycle operations as engineering
  decisions rather than feature claims.
- Keep the reference sections in the same README because repository policy
  forbids a standalone `docs/` directory.
- Do not change runtime behavior, package version, install contract, or
  semantic-companion boundary in this presentation-only change.
