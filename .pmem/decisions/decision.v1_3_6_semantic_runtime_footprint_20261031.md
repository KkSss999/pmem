---
id: decision.v1_3_6_semantic_runtime_footprint_20261031
type: decision
title: "v1.3.6 Semantic Runtime Footprint Decisions"
status: active
tags: [semantic-search, embeddings, onnx, runtime, v1.3.6]
created: "2026-10-31"
updated: "2026-10-31T02:45:00.000Z"
source_files:
  - src/core/semantic/transformers.ts
  - src/core/semantic/cache.ts
  - src/core/semantic/onnxRuntime.ts
  - src/core/semantic/rebuildRunner.ts
  - src/core/semantic/lifecycle.ts
  - src/workers/semanticIndex.ts
  - src/commands/semanticRuntime.ts
depends_on:
  - decision.sqlite_first_semantic_layer_20260626
related_to:
  - feature.v1_1_1_lightweight_semantic_layer_20260626
last_verified: "2026-10-31T02:45:00.000Z"
classification: decision
trust_label: user_confirmed
sensitivity: internal
---
# v1.3.6 Semantic Runtime Footprint Decisions

## Context

Measured on the pinned `Xenova/multilingual-e5-small` runtime (RTX-free CPU host, Node 24):

- `onnxruntime-node` installs at ~548 MB (every OS/arch plus CUDA and TensorRT providers); the CPU core is ~45 MB. `onnxruntime-web` adds ~141 MB that Transformers.js already bundles into its Node dist.
- Embedding throughput: `q8` (`model_quantized.onnx`) 365–388 texts/s vs `uint8` 299–307 texts/s at an identical 113 MB artifact; vectors agree.
- RSS after a full pipeline load: ~500 MB. The 250k-vocab tokenizer alone is ~255 MB (168 MB JS heap) because `@huggingface/tokenizers` is pure JavaScript. `dispose()` releases the heap but leaves ~440 MB RSS (native arenas), so only process exit returns it.
- Chunk search over 100k chunks: 1255 ms when every row is materialized with card text; 611 ms when only vectors are read and the top rows are hydrated afterwards.

## Decisions

1. **q8 is the default quantization for new setups.** `uint8` stays accepted so existing caches keep working without re-download or re-index; `SEMANTIC_PIPELINE_VERSION` is unchanged. Cache identity and pinned digests became dtype-aware (`ONNX_MODEL_FILE`, `expectedOnnxSha256`).
2. **Prune the inference runtime at setup/rebuild, not at install.** npm 11 blocks dependency install scripts and pnpm/bun do not run them, so a postinstall hook would silently miss users. Pruning runs once, before the native library is imported, guarded by `~/.pmem-global/.onnx-runtime-pruned-v1`; `PMEM_ORT_GPU=1` opts out.
3. **Rebuild in a child process.** The parent keeps its own memory and the child exits, which is the only way to return the ~440 MB the runtime holds after `dispose()`. `PMEM_SEMANTIC_INLINE=1` forces the in-process path (used when no compiled worker exists).
4. **Rank on vectors, hydrate winners.** `scoreSemanticChunks` returns `{chunk_id, card_id, similarity}` only; `hydrateSemanticChunks` loads text for the returned rows. The relevance gate is unchanged, so abstention behavior is identical.

## Rejected

- Loading a per-language tokenizer subset: measured 19 MB saving after dropping 122k of 250k entries, because token id == embedding-table row, so slots cannot shrink. Fixed cost is ~1.1 KB RSS per vocabulary entry.
- ONNX `q4` for this model: 380 MB artifact and higher RSS than `q8`.
- In-memory flat vector array: 10x faster (63 ms @100k) but costs ~150 MB RSS and cache invalidation; deferred until catalog-scale use proves it necessary.
- Keeping the tokenizer in a long-lived host process: no way to release 255 MB without process exit.
