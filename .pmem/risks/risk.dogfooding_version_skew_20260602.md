---
id: risk.dogfooding_version_skew_20260602
type: risk
title: "Dogfooding Version Skew"
status: active
tags: [dogfooding, release, npm, version-skew]
created: "2026-06-02"
updated: "2026-07-03T23:59:59.000Z"
source_files:
  - package.json
  - package-lock.json
  - CHANGELOG.md
depends_on: []
related_to:
  - decision.dogfood_pmem_for_pmem_development_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
last_verified: "2026-08-03T08:33:45.574Z"
classification: risk
trust_label: user_confirmed
sensitivity: internal
---
# Dogfooding Version Skew

## Risk

The published npm latest package and the repository's sealed baseline can diverge, which makes "use the latest published pmem" ambiguous during dogfooding.

## Observed State

During v0.8.0 release closure:

- Local `package.json` and `package-lock.json` report `0.8.0`.
- Local dogfood uses `node dist/index.js` against the current working tree.
- `npm pack --dry-run` reports `pmem-ai@0.8.0`.

Earlier initialization observed published/local skew (`npm view pmem-ai version` returned `0.6.3` while local work was ahead), so release validation must continue to name whether it uses local `dist/index.js` or the published npm package.

## Impact

Using npm latest would dogfood an older CLI than the local codebase expects. Using local `dist/index.js` may dogfood uncommitted work. Both choices are valid in different contexts, but reviews must name which one they use.

## Mitigation

- For this repository, use `node dist/index.js` during active dogfooding so memory reflects the current development branch.
- For release validation, explicitly test against the published npm package.
- Before v0.7.0 release, clarify whether v0.6.4 has been published to npm or only tagged in git.
- Keep generated memory cards under version control so handoff memory is not tied to a local SQLite DB.
