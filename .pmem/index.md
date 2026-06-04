# Project Memory Index

## Project
Name: pmem
Stage: v0.7.1 completed and validated; awaiting final release approval.
Status: active

## Summary
pmem is a local project-memory CLI for AI agents, now dogfooding its own memory system for v0.7.1 development.

## Detected Stack
- Node.js
- TypeScript

## Current Focus
Prepare and verify pmem v0.7.1 release metadata, documentation, and regression testing.

## Read First
- .pmem/state.md
- .pmem/next.md
- .pmem/features/feature.v0_7_0_universal_agent_memory_20260602.md
- .pmem/tasks/task.v0_7_0_phase_2_domain_presets_20260602.md

## Stable Decisions
- decision.v0_7_0_zero_migration_compatibility_20260602
- decision.dogfood_pmem_for_pmem_development_20260602

## Current Risks
- risk.dogfooding_version_skew_20260602

## CLI
Use:
- node dist/index.js session start -a "Codex"
- node dist/index.js recall --format compact --budget 2000
- node dist/index.js ask "<query>" --format compact
- node dist/index.js status --format json

## Notes
- This project intentionally dogfoods pmem to manage pmem's own development memory.
- The npm latest package was checked during initialization and was `pmem-ai@0.6.3`; the repository baseline is v0.6.4 and current work targets v0.7.1.
- The working tree already contained uncommitted Phase 2 domain-preset changes before this memory initialization.
