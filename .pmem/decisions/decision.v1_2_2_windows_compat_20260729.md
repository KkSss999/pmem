---
id: decision.v1_2_2_windows_compat_20260729
type: decision
title: "v1.2.2: Windows joins macOS as a mandatory supported platform"
status: accepted
classification: decision
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.2, windows, platform-policy, compatibility, release]
created: "2026-07-29"
updated: "2026-07-29"
source_files:
  - src/core/fs.ts
  - src/commands/rebuild.ts
  - src/core/query/recall.ts
  - src/core/moduleInfer.ts
  - src/core/health/migration.ts
depends_on:
  - decision.post_v1_1_macos_required_platform_20260724
related_to:
  - decision.v1_1_1_macos_semantic_retrieval_20260724
last_verified: "2026-08-03T06:00:02.275Z"
---
# v1.2.2 Windows Compatibility

## Decision

[[decision.post_v1_1_macos_required_platform_20260724]] made macOS the only mandatory supported and acceptance-tested platform after v1.1.0, and explicitly required a new decision (not inferred Node/TS portability) before extending that promise to another OS.

Starting with v1.2.2, **Windows becomes a second mandatory supported and acceptance-tested platform**, alongside macOS, for the base CLI, SDK, and runtime (`pmem-ai`). Every future release must pass its full test suite and CLI smoke path on both platforms before acceptance.

Linux remains outside the compatibility promise and is not a release blocker.

## What changed

Real Windows usage surfaced two classes of defect that the macOS-only test matrix could not catch:

1. **`fs.fsyncSync` on a read-only handle throws `EPERM` on Windows.** `atomicWrite` (`src/core/fs.ts`) opened its temp file with `'r'` before fsyncing it; POSIX allows this, Windows does not. Every code path that persists cards or JSON through `atomicWrite`/`writeJson` was silently broken on Windows. Fixed by opening `'r+'`.
2. **Relative paths built with `path.relative()` are backslash-separated on Windows**, but card `file_path` values (SQLite `cards.file_path`, `recall`/`ask` output, module inference `source_files`, health-migration diagnostics) are a stored, cross-platform contract that assumes `/`. Some call sites already normalized manually (`capture.ts`, `traceSummary.ts`, `status.ts`, `doctor.ts`); others (`rebuild.ts`, `recall.ts`, `moduleInfer.ts`, `health/migration.ts`) did not, and on Windows this broke directory-prefix checks (`.includes('/candidates/')`, `.startsWith('skills/')`) and any comparison against a posix-shaped path. Fixed with one shared `toPosixPath()` helper in `src/core/fs.ts`, applied at every point a relative path is persisted or compared.
3. Two integration tests (`ask.test.ts`, `health.test.ts`) left a `better-sqlite3` handle open across their cleanup step; Windows refuses to delete a directory containing an open file handle (POSIX allows it). Fixed by calling `closeDatabase()` before `fs.rmSync` in the affected `after`/`afterEach` hooks.

## Product Boundary

- No new platform-specific code paths, feature flags, or Windows-only behavior. The fix is the same deterministic Markdown/SQLite pipeline on every platform; path normalization and fsync semantics are corrected, not branched.
- `toPosixPath()` is the single point of truth for turning a `path.relative()` result into the on-disk/on-record contract. Any future call site that stores or compares a relative path must use it.
- Semantic retrieval (`pmem-ai-semantic`) remains macOS-only per [[decision.v1_1_1_macos_semantic_retrieval_20260724]]; this decision does not extend the semantic companion's platform promise.

## Acceptance

Full test suite (429 tests) passes on Windows with no skips. `npm run build` is clean. `init → new → rebuild → verify → ask` smoke-tested end to end on a real Windows temp project, with SQLite `cards.file_path` confirmed forward-slash-normalized.
