# pmem-ai-semantic

Optional local semantic inference runtime for [`pmem-ai`](https://www.npmjs.com/package/pmem-ai).
It is intentionally distributed separately because Transformers.js includes large native inference
and image-processing dependencies that deterministic pmem users do not need.

Install this package explicitly only on a machine where semantic retrieval is wanted:

```bash
npm install -g pmem-ai-semantic@1.3.2
pmem semantic enable
```

`pmem semantic enable` performs the guided model setup and project index build. Operators can still run `pmem semantic setup` and `pmem semantic rebuild` separately.

The runtime loads the pinned model exclusively from the cache prepared by `pmem semantic setup`;
remote model loading remains disabled during inference.

This companion intentionally contains the isolated Transformers.js native dependency graph. Its production dependency audit is run and reported separately from the base `pmem-ai` package so users who do not enable semantic retrieval never install that graph.

Repository contributors can opt in without changing the root manifest or lockfile:

```bash
npm install --no-save --package-lock=false ./packages/semantic-runtime
PMEM_RUN_SEMANTIC_EVAL=1 PMEM_SEMANTIC_CACHE="$HOME/.pmem-global/models/Xenova/multilingual-e5-small/<revision>" \
  node --require ts-node/register --test src/core/query/engine/semantic-evaluation.live.test.ts
```
