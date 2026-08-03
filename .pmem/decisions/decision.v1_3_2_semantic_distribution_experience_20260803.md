---
id: decision.v1_3_2_semantic_distribution_experience_20260803
type: decision
title: "v1.3.x Semantic Runtime Distribution and ContextPack Experience"
status: active
tags: [v1.3.2, semantic-runtime, packaging, context-pack, distribution]
created: "2026-08-03"
updated: "2026-08-03T00:00:00.000Z"
depends_on:
  - decision.v1_3_0_runtime_first_schema_driven_backend_pluggable_20260802
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
  - feature.v1_1_2_contextual_rerank_retrieval_20260626
classification: decision
token_policy: relaxed
trust_label: user_confirmed
sensitivity: internal
last_verified: "2026-08-03T03:46:21.777Z"
---

# v1.3.x Semantic Runtime Distribution and ContextPack Experience

## Decision

Keep `pmem-ai` as the only recommended user-facing CLI entry. Keep
`pmem-ai-semantic` as a separately distributed local execution component so
native Transformers/ONNX/sharp dependencies do not inflate every base install.
Users start semantic setup from the base CLI with `pmem semantic setup`; when
the component is missing, the CLI reports the exact compatible install command
and the user reruns setup. Deterministic `ask`, `context`, and `recall` remain
usable without the component, model cache, or semantic index.

## ContextPack contract

CLI, SDK, and MCP consume the Runtime-generated ContextPack rather than
assembling divergent prompt text. The structured payload includes `records`,
validated provenance-bearing `evidence`, execution `provenance`, `budget`,
omission `diagnostics`, and `schemaVersion`. Packing reserves budget for
evidence, caps evidence fan-out at three items per record by default, and uses
deterministic diversity ordering. ContextPack is a memory payload, not a prompt
template; each Agent decides how to format it for a model.

## Non-goals

- Do not add a third `pmem-ai-full` package.
- Do not auto-download the semantic model from the base package install.
- Do not merge the core CLI and local semantic component in this docs-only
  change.
