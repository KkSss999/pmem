---
id: decision.v1_2_2_windows_semantic_retrieval_20260729
type: decision
title: "v1.2.2: extend opt-in semantic retrieval to Windows"
status: accepted
classification: decision
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, windows, semantic-search, embeddings, platform-policy]
created: "2026-07-29"
updated: "2026-07-29"
source_files:
  - src/commands/semantic.ts
  - src/core/semantic/transformers.ts
  - packages/semantic-runtime/package.json
depends_on:
  - decision.v1_2_2_windows_compat_20260729
  - decision.v1_1_1_macos_semantic_retrieval_20260724
related_to:
  - decision.post_v1_1_macos_required_platform_20260724
---
# v1.2.2 Windows Semantic Retrieval

## Decision

[[decision.v1_2_2_windows_compat_20260729]] made Windows a mandatory supported platform for the base CLI/SDK/runtime but explicitly left the semantic companion (`pmem-ai-semantic`) macOS-only. This decision (shipped as v1.2.3) lifts that exclusion: `pmem semantic setup`/`enable` are now accepted on `win32` in addition to `darwin`, on request, after confirming the companion's native dependency chain (`@huggingface/transformers` → `onnxruntime-node`, `sharp`) installs and loads on Windows with prebuilt binaries — no native compilation required.

`pmem semantic setup`/`enable` reject every platform other than `darwin` and `win32` (e.g. Linux remains unsupported and untested).

## What changed

- `semanticCommand`'s platform gate (`src/commands/semantic.ts`) now accepts `win32` alongside `darwin`.
- `SEMANTIC_COMPANION_VERSION` and all install-command strings bumped to `1.2.3` to match the release.
- CLI help text and README updated to say "macOS and Windows" instead of "macOS only".

## Verification

- `npm install @huggingface/transformers@4.2.0` succeeds on Windows via npm-resolved prebuilt binaries; `pipeline` from the package resolves and loads without a native build step.
- Full test suite (430/430) passes with the platform gate change, including a new `accepts setup on win32` case.
- `pmem semantic setup` downloaded and cached the pinned model on a real Windows machine. `pmem semantic rebuild --full` built the derived index, and `pmem ask --explain` returned a semantic-scored match (`semantic:cosine 0.84`) fused with deterministic candidates, confirming embedding inference and hybrid retrieval both work end to end on Windows.
- Found and fixed a second Windows bug during this verification: `packages/semantic-runtime/index.js`'s absolute-path check used `cachePath.startsWith('/')`, which is always false for a Windows path (`C:\...`). Replaced with `path.isAbsolute()`.

## Product Boundary

- No Windows-specific code path is introduced; the underlying retrieval pipeline, model, and storage boundary are unchanged from [[decision.v1_1_1_macos_semantic_retrieval_20260724]].
- Linux is not covered by this decision and remains unsupported for both the base CLI and the semantic companion.
