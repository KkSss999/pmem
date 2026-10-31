---
id: decision.v1_3_6_bun_oxc_toolchain_20261031
type: decision
title: "Bun and Oxc as the Default Toolchain"
status: active
tags: [toolchain, bun, oxc, build, v1.3.6]
created: "2026-10-31"
updated: "2026-10-31T03:20:00.000Z"
source_files:
  - package.json
  - bun.lock
  - .oxlintrc.json
  - .oxfmtrc.jsonc
  - .github/workflows/ci.yml
  - scripts/version-consistency.test.js
  - scripts/e2e-install-smoke.sh
  - scripts/e2e-semantic-runtime-smoke.sh
depends_on:
  - decision.v1_3_6_semantic_runtime_footprint_20261031
last_verified: "2026-10-31T03:20:00.000Z"
classification: decision
trust_label: user_confirmed
sensitivity: internal
---
# Bun and Oxc as the Default Toolchain

## Decisions

1. **Bun replaces npm/pnpm for development, CI, and publishing.** `packageManager` pins `bun@1.4.4`; `bun.lock` is the only lockfile. `bun publish` runs `prepublishOnly`, verified with a fixture package before switching CI.
2. **`trustedDependencies` lists only `better-sqlite3`.** It needs its prebuild install. `onnxruntime-node` stays untrusted on purpose: its postinstall only downloads CUDA/TensorRT binaries that CPU inference never loads, and `ensureOnnxRuntimePruned` deletes them anyway. Net effect on a fresh `bun install`: 288 MB unpacked instead of 548 MB, then 45 MB after pruning.
3. **Oxc is the lint/format layer; TypeScript keeps type checking.** `oxlint` runs with `correctness` as errors so CI blocks on real defects, while five rule families that fire on intentional pre-existing patterns (`no-unused-vars`, `no-control-regex`, `no-useless-escape`, `typescript/no-this-alias`, `unicorn/no-useless-fallback-in-spread`) stay warnings. `oxfmt` is Prettier-compatible, pinned to `printWidth: 100`, `singleQuote: true`, `trailingComma: all`, and scoped to `src` and `scripts` so hand-curated Markdown is untouched.
4. **End users keep choosing their registry client.** The published artifact is a normal npm package; docs lead with `bun add -g` and keep `npm install -g`. Only the project's own toolchain is Bun-only.

## CI Shape

Three jobs only:

- `verify`: `bun install --frozen-lockfile`, `bun run check`, `bun run test` (the test script builds first).
- `pack`: `bun pm pack`, assert the tarball has no `src/`, tests, `temp/`, or `node_modules/` and does contain `dist/index.js`, `dist/workers/semanticIndex.js`, `dist/core/semantic/transformers.js`; then `bun add` the tarball and run `pmem init` against a real SQLite file.
- `publish`: version check against the registry, `bun publish --access public`, registry visibility wait, GitHub release.

Removed as redundant: the Node 18/20/22 matrix, the nine E2E script stages, the semantic-runtime pack smoke, and `npm audit`. `bun run test:e2e:*` still runs each of them locally. Trade-off accepted: the `node >= 18` engine floor is no longer exercised in CI (it runs on Node 22 only), and dependency advisories are no longer gated.

## Evidence

- `bun run test` → 599 pass, `bun run check` → typecheck + 0 lint errors + format clean.
- `bash scripts/e2e-install-smoke.sh` → packs with `bun pm pack`, installs with `bun add -g` into a `BUN_INSTALL` prefix, `pmem init` and `pmem context` succeed (better-sqlite3 binding present).
- `bash scripts/e2e-semantic-runtime-smoke.sh` → pack contents include `dist/workers/semanticIndex.js`; `bun pm pack --dry-run` emits `packed <size> <path>` lines instead of npm's `--json`.
- `bun pm pack --quiet --destination <dir>` prints the full tarball path (npm printed the bare filename), so scripts take `basename`.

## Caveats

- `oxfmt` 0.75.0 (beta) needed a second pass to converge on one file (`src/runtime/types.ts`); `bun run format` is therefore not guaranteed idempotent in a single run.
- `npm audit` remains in the pack job as the registry advisory client; `bun pm scan` requires configuring a third-party scanner and is not a drop-in replacement.
- Node stays the test runtime (`node --test`, matrix 18/20/22) and the compiled artifact target; Bun runs the toolchain, not the tests.
