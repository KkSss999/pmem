# Next Steps

<!-- pmem:next:start -->
## Recommended Next Step
Prepare v0.8.0 release commit/tag and publish checklist, or start v0.8.5 semantic layer design.

## Why
v0.8 Hybrid Recall Engine implementation and local acceptance are complete: source_file lookup, always-on FTS/BM25 fusion, explain scoring, recall modes, context metadata, tests, build, and dogfood CLI verification passed.

## Needed Context
- v0.8.0 version is set in package metadata.
- Run `npm test && npm run build` before publish.
- Dogfood query: `node dist/index.js ask "src/core/query/engine/candidates.ts" --explain --limit 5`.
<!-- pmem:next:end -->
