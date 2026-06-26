# Project Memory Index

## Project
Name: pmem
Stage: v0.7.5 published; v0.8 Project RAG OS architecture planning.
Status: active

## Summary
pmem is a local project-memory CLI and Markdown-card memory runtime for AI agents. Its updated direction is a structure-first Project RAG OS: structured project memory, high-quality hybrid recall, evidence traceability, and agent-safe memory CRUD.

## Detected Stack
- Node.js
- TypeScript

## Current Focus
Run the RAG research sprint and produce the v0.8 Hybrid Recall Engine architecture decision.

## Read First
- .pmem/state.md
- .pmem/next.md
- .pmem/decisions/decision.project_rag_os_positioning_20260626.md
- .pmem/tasks/task.rag_research_sprint_20260626.md
- .pmem/features/feature.v0_8_hybrid_recall_engine_20260626.md
- .pmem/modules/module.recall_retrieval_runtime_20260626.md
- .pmem/features/feature.v0_7_0_universal_agent_memory_20260602.md
- .pmem/tasks/task.v0_7_0_phase_2_domain_presets_20260602.md

## Stable Decisions
- decision.project_rag_os_positioning_20260626
- decision.structure_first_hybrid_recall_20260626
- decision.sqlite_first_semantic_layer_20260626
- decision.v0_7_0_zero_migration_compatibility_20260602
- decision.dogfood_pmem_for_pmem_development_20260602

## Current Risks
- risk.rag_scope_creep_heavy_vector_stack_20260626
- risk.dogfooding_version_skew_20260602

## CLI
Use:
- pmem session start -a "Codex"
- pmem recall --format compact --budget 2000
- pmem ask "<query>" --format compact
- pmem status --format json

## Notes
- This project intentionally dogfoods pmem to manage pmem's own development memory.
- As of 2026-06-26, local and published `pmem-ai` are on v0.7.5.
- Older v0.7.5 Web UI / graph-visualization cards are preserved as historical design material but are deferred by the Project RAG OS repositioning.
