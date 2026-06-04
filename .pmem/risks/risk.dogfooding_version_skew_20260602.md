---
id: risk.dogfooding_version_skew_20260602
type: risk
title: "Dogfooding Version Skew"
status: active
tags: [dogfooding, release, npm, version-skew]
created: "2026-06-02"
updated: "2026-06-02T19:52:43.628Z"
source_files:
  - package.json
  - CHANGELOG.md
  - docs/project-roadmap.md
depends_on: []
related_to:
  - decision.dogfood_pmem_for_pmem_development_20260602
  - feature.v0_7_0_universal_agent_memory_20260602
last_verified: "2026-06-04T22:03:36.793Z"
---
# Dogfooding Version Skew

## Risk

The published npm latest package and the repository's sealed baseline can diverge, which makes "use the latest published pmem" ambiguous during dogfooding.

## Observed State

During initialization:

- `npm view pmem-ai version` returned `0.6.3`.
- The handoff said v0.6.4 was sealed in git with tag `v0.6.4`.
- Local `package.json` reports `0.6.4`.
- The current working tree includes uncommitted v0.7.0 Phase 2 changes.

## Impact

Using npm latest would dogfood an older CLI than the local codebase expects. Using local `dist/index.js` may dogfood uncommitted work. Both choices are valid in different contexts, but reviews must name which one they use.

## Mitigation

- For this repository, use `node dist/index.js` during active dogfooding so memory reflects the current development branch.
- For release validation, explicitly test against the published npm package.
- Before v0.7.0 release, clarify whether v0.6.4 has been published to npm or only tagged in git.
- Keep generated memory cards under version control so handoff memory is not tied to a local SQLite DB.
