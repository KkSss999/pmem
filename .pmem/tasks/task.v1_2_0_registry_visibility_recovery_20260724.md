---
id: task.v1_2_0_registry_visibility_recovery_20260724
type: task
title: "Recover v1.2.0 npm registry visibility transaction"
status: in_progress
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
tags: [v1.2.0, npm, release, registry, ci, hotfix]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - .github/workflows/ci.yml
  - scripts/npm-release-state.js
  - scripts/npm-release-state.test.js
  - scripts/wait-for-npm-package.sh
  - package.json
related_to:
  - task.v1_2_0_unified_release_20260724
---
# v1.2.0 Registry Visibility Recovery

## Incident

After PR #17 merged as `579a6e3`, npm accepted
`pmem-ai-semantic@1.2.0` at `2026-07-24T09:47:07Z`, but public metadata and
tarball reads remained 404 beyond the workflow's 60-second confirmation
window. The registry write-side document contained the exact version, matching
shasum, and tarball coordinates while public read replicas were still stale.
The release transaction correctly skipped `pmem-ai@1.2.0` and the GitHub
Release, but an immediate rerun would have misclassified the accepted companion
as missing and attempted to publish the immutable version again.

Public companion visibility recovered roughly 13 minutes after acceptance.

## Hotfix Contract

- Classify each exact package version as `public`, `accepted_pending`, or
  `missing`; only `missing` may execute `npm publish`.
- Treat unexpected registry responses as fatal rather than as absence.
- After each optional publish, wait up to 15 minutes for both public metadata
  and the registry tarball to be retrievable.
- Apply the same recovery contract to companion and root packages so retries
  resume safely from either partial-publish boundary.
- Create the GitHub Release only after both exact npm versions are publicly
  installable.

## Local Evidence

- Six registry-state regression tests pass, including accepted-but-public-404,
  old public replica, exact missing, and unexpected HTTP response cases.
- The live registry classifier reports the companion as `public` after delayed
  convergence and `pmem-ai@1.2.0` as `missing`.
- Public metadata plus tarball validation succeeds against `pmem-ai@1.1.0`.
- Full `npm test` passes `405/405`; TypeScript build, shell syntax,
  `actionlint`, and `git diff --check` pass.

## Close Gate

Merge the hotfix, allow the main-branch transaction to skip the already
published companion, publish and confirm `pmem-ai@1.2.0`, and create the
`v1.2.0` GitHub Release. Do not mark this task completed merely because the
hotfix PR is open.
