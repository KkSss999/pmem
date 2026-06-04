---
id: trace.v0_7_0_release_readiness_validation_20260602
type: trace
title: "v0.7.0 release readiness validation"
status: active
tags: [release, v0.7.0]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files: [package.json, CHANGELOG.md, README.md, docs/usage.md]
depends_on: []
related_to: []
last_verified: "2026-06-04T22:08:24.970Z"
---
# v0.7.0 release readiness validation

This trace documents the release readiness checklist validation for `pmem` v0.7.0.

## Completed Tasks

1. **Hygiene Check**: Verified `.gitignore` correctly ignores SQLite database files, lock files, and indexes (`.pmem/pmem.db`, `.pmem/pmem.db-*`, `.pmem/.lock`, `.pmem/indexes/`).
2. **Version Bump**: Bumped version to `0.7.0` in `package.json`, `src/index.ts` program version, and `CURRENT_TEMPLATE_VERSION` in `src/commands/integration.ts`.
3. **Documentation Updates**:
   - Updated `README.md` and `docs/usage.md` to cover `pmem init --domain`, custom manifest schema parameters (`schema.card_types`, etc.), autodiscovery settings (`discover.enabled`), recall outputs (`active_foundation`), and backward compatibility instructions.
   - Updated `CHANGELOG.md` with v0.7.0 logs and marked v0.7.0 as completed in `docs/project-roadmap.md`.
   - Verified `docs/release-checklist-v0.7.0.md` was created.

## Test Results

All test suites passed successfully:
- Unit tests: 167/167 tests passed.
- E2E tests:
  - `test:e2e:workflow`: Passed
  - `test:e2e:v061-suggest`: Passed
  - `test:e2e:v063-discover`: Passed
  - `test:e2e:v07-novel`: Passed
  - `test:e2e:v07-research`: Passed
  - `test:e2e:install`: Passed

## NPM and Tag Check

- NPM registry latest version: `0.6.3`
- Git local tags: `v0.6.4` exists locally, but has not been published to NPM.
- Recommendation: Since v0.7.0 contains major feature updates and has fully verified backward compatibility, we recommend directly tagging `v0.7.0` and publishing it to NPM.
