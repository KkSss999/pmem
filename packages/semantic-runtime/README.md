# pmem-ai-semantic

Optional local semantic inference runtime for [`pmem-ai`](https://www.npmjs.com/package/pmem-ai).
It is intentionally distributed separately because Transformers.js includes large native inference
and image-processing dependencies that deterministic pmem users do not need.

Install this package explicitly only on a machine where semantic retrieval is wanted:

```bash
npm install -g pmem-ai-semantic@1.2.0
pmem semantic setup
pmem semantic rebuild
```

The runtime loads the pinned model exclusively from the cache prepared by `pmem semantic setup`;
remote model loading remains disabled during inference.

Repository contributors can opt in without changing the root manifest or lockfile:

```bash
npm install --no-save --package-lock=false ./packages/semantic-runtime
PMEM_RUN_SEMANTIC_EVAL=1 PMEM_SEMANTIC_CACHE="$HOME/.pmem-global/models/Xenova/multilingual-e5-small/<revision>" \
  node --require ts-node/register --test src/core/query/engine/semantic-evaluation.live.test.ts
```
