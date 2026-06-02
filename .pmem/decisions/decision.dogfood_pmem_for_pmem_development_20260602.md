---
id: decision.dogfood_pmem_for_pmem_development_20260602
type: decision
title: "Dogfood pmem for pmem Development"
status: active
tags: [dogfooding, process, cto, memory]
created: "2026-06-02"
updated: "2026-06-02T19:45:26Z"
source_files:
  - .pmem/manifest.yml
  - .pmem/index.md
  - .pmem/state.md
  - .pmem/next.md
depends_on: []
related_to:
  - risk.dogfooding_version_skew_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
---
# Dogfood pmem for pmem Development

## Decision

Use pmem itself to manage pmem project development memory, starting during v0.7.0 Phase 2.

## Rationale

The project is a memory system for AI agents. Continuing to manage CTO handoff, review decisions, and development plans only through chat context creates avoidable memory loss and undermines product confidence.

## Operating Model

At session start:

```bash
node dist/index.js session start -a "Codex"
node dist/index.js recall --format compact --budget 2000
node dist/index.js ask "<current task>" --format compact
```

After meaningful work:

```bash
node dist/index.js status --format json
node dist/index.js update --suggest --format json
node dist/index.js verify
```

CTO review decisions should be captured as `decision` or `trace` cards. Development plans should be captured as `task` cards. Stable architecture areas should be captured as `module` or `feature` cards.

## Initial Scope

This initialization records:

- v0.7.0 Phase 1 acceptance
- Phase 2 domain preset plan
- zero-migration compatibility decision
- npm/latest versus local-version skew risk

## Note

The memory repository was initialized with the current local CLI, whose `dist` already includes Phase 2 uncommitted changes. This is intentional dogfooding, but should be remembered during review.
