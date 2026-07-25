---
id: task.v1_2_1_deep_usage_reliability_20260724
type: task
title: "Develop and accept v1.2.1 deep-usage reliability fixes"
status: completed
priority: P0
classification: plan
trust_label: user_confirmed
sensitivity: internal
token_policy: relaxed
tags: [v1.2.1, github-issues, reliability, ux, semantic, non-git, release]
created: "2026-07-24"
updated: "2026-07-24"
source_files:
  - package.json
  - packages/semantic-runtime/package.json
  - src/commands/rebuild.ts
  - src/core/query/status.ts
  - src/core/query/context.ts
  - src/commands/update.ts
  - src/commands/new.ts
  - src/runtime/index.ts
  - src/commands/doctor.ts
  - src/commands/ask.ts
  - src/core/query/ask.ts
  - src/core/semantic/lifecycle.ts
  - src/commands/verify.ts
depends_on:
  - task.v1_2_0_unified_release_20260724
related_to:
  - decision.v1_2_0_unified_memory_intelligence_release_20260724
---
# v1.2.1 Deep-Usage Reliability

## Goal

Close all ten user-filed GitHub Issues #19 through #28 as one v1.2.1
maintenance release. The release must make card ingestion, non-Git change
tracking, structured output, semantic relevance, diagnostics, and destructive
operations trustworthy under real deep-use workflows.

## Locked Issue Scope

### Card discovery and change tracking

- #19: `rebuild` and `sync` must report every Markdown file under a card
  directory that cannot be indexed, including the file and specific validation
  reason; invalid files must never disappear silently.
- #22: `mark-dirty --auto` must use the same mtime fallback as `status` outside
  Git and retain a machine-readable source/result contract.
- #27: mtime fallback must detect every newly created or changed card even when
  multiple files share close or identical timestamps.
- #28: `context --format json` must return each changed path once with a stable,
  deterministic status when multiple sources mention it.

### Creation, recovery, and destructive-operation UX

- #21: `pmem new` must accept an explicit meaningful card ID/slug while keeping
  the existing generated-ID path backward compatible; IDs, types, collisions,
  traversal, and manifest schema membership must be validated before writing.
- #23: `forget` must not create a tombstone or report success for an identifier
  that does not resolve to an existing live card or memory observation.
- #24: `doctor` must use the same exit-code contract in text and JSON modes;
  warning-only results exit 0 and errors exit 2.
- #26: empty-result, migration-validation, doctor, and verify output must provide
  bounded actionable diagnostics rather than undifferentiated noise. JSON stays
  parseable and stable; `--explain` remains useful even with zero matches.

### Semantic trust and relevance

- #20: semantic zero-result output must distinguish an actually empty project
  from an empty/excluded semantic index and point to `semantic status` and safe
  trust-label migration. Missing trust remains excluded rather than silently
  elevated.
- #25: semantic candidates must pass an evidence-backed relevance/noise gate so
  unrelated queries do not return the entire project with compressed cosine
  scores. Exact deterministic authority and the locked v1.2.0 quality metrics
  must remain intact.

## Cross-Issue Contracts

- Markdown remains canonical and SQLite/semantic data remains rebuildable.
- No missing trust label is automatically promoted to trusted.
- No command may claim a write/destructive success if it made no valid change.
- Text and JSON modes describe the same state and use the documented `0`/`2`
  exit-code contract.
- Non-Git novel, research, and software projects remain first-class.
- Diagnostics are deduplicated and summarized without hiding exact details from
  JSON or a deliberate verbose/explain path.
- Both npm packages move together to `1.2.1`; the base package remains free of
  the isolated semantic native dependency chain.

## Acceptance Gate

- Each Issue #19-#28 has at least one regression test that fails against v1.2.0
  behavior and passes after the fix; shared-root issues also have an integrated
  workflow test.
- A real non-Git fixture proves init/new/edit/status/mark-dirty/sync/context can
  complete without Git and without missed or duplicate paths.
- Invalid-card fixtures prove rebuild/sync name each skipped file and exact
  reason without indexing partial data.
- Custom ID tests cover exact ID, slug form, duplicate collision, invalid type,
  traversal, and legacy generated IDs.
- Forget tests cover existing cards/observations, absent IDs, already-forgotten
  IDs, and CLI/Runtime/MCP consistency without meaningless tombstones.
- Doctor text/JSON warning-only and error states have identical semantic results
  and expected exit codes.
- Empty-result diagnostics cover no cards, stale/missing index, semantic index
  with exclusions, invalid trust migration input, and `--explain` diagnostics.
- An irrelevant-query semantic fixture returns no/bounded noise while the live
  v1.2.0 gates remain at least Recall@5 `0.95`, MRR `0.865414`, exact success
  `60/60`, candidate Recall@50 `1.0`, and hard-negative NDCG@10 improvement
  `+0.076658`; 300-card warm-query p95 remains within the v1.2.0 release bound.
- Full unit suite, TypeScript build, release E2E matrix, both package dry-runs,
  isolated tarball installation, root/companion audits, workflow validation,
  `git diff --check`, `pmem rebuild`, and `pmem verify` pass with recorded
  evidence.

## Delivery Boundary

Develop and accept v1.2.1 as one unit. Do not stage, commit, push, close Issues,
publish packages, create a tag, or open/update a PR until the user has reviewed
the complete local acceptance report.

## Acceptance Record

Validated locally on Apple Silicon macOS on 2026-07-24 as one v1.2.1 release
unit covering GitHub Issues #19 through #28:

- TypeScript build and the final automated suite passed: 427 tests, 0 failures;
  the separately gated live semantic evaluation is intentionally skipped in
  the ordinary suite.
- Ten real CLI E2E journeys passed: tarball install/first-project, daily
  workflow, both non-Git suites, novel, research, sync, agent UX, context
  restoration, and next-step deduplication.
- The companion-backed live gate passed with Recall@5 `0.95`, MRR `0.865414`,
  exact success `60/60`, candidate Recall@50 `1.0`, and hard-negative NDCG@10
  improvement `+0.076658`. All 12 v1.2.1 out-of-domain queries abstained with
  no leaked card IDs; the 300-card warm-query p95 was `6.381 ms`.
- Both `pmem-ai@1.2.1` and `pmem-ai-semantic@1.2.1` package dry-runs passed.
  Isolated tarballs installed successfully; the root install contained none of
  Transformers.js, ONNX Runtime, sharp, or adm-zip, and the explicitly installed
  companion exposed API v1.
- Root production audit passed with 0 high and 0 critical advisories; its two
  pre-existing moderate MCP SDK advisories remain disclosed. The opt-in
  companion stayed at the accepted isolated baseline of 5 high and 0 critical,
  with no new package, advisory, available fix, or baseline drift.
- Release registry-state tests and `git diff --check` passed. Package, companion,
  lockfile, runtime compatibility, README, changelog, and distributed Skill
  installation guidance all identify v1.2.1.
- Regression coverage proves invalid cards remain visible and are removed from
  stale indexes, missing/invalid trust labels are diagnosed without elevation,
  custom IDs are safe, false forget success is rejected, doctor exit semantics
  agree across formats, semantic OOD queries abstain, diagnostics are bounded,
  non-Git fingerprints survive read-only status calls and timestamp races, and
  JSON changed-file output is stable and deduplicated.

No staging, commit, push, issue closure, tag, publish, or pull request was
performed. User review of this local acceptance report remains the prerequisite
for repository delivery actions.

## Review Reopen — 2026-07-25

The first v1.2.1 acceptance is reopened after deep review found two remaining
cross-issue regressions:

- P1: legacy manifests without `schema` still exclude the entire `.pmem` tree
  during non-Git fallback, so resolved legacy card directories are scanned but
  every card below them is skipped.
- P2: `doctor` uses all database rows, including tombstones, as its indexed-card
  health proxy and can report `0 active card(s)` as healthy while canonical
  source cards exist.

Close this reopen only after both reproductions have regression coverage, the
targeted fixes pass, and the full v1.2.1 release gate is rerun. The delivery
boundary remains unchanged.

## Review Reopen Closeout — 2026-07-25

Both review blockers are fixed and the complete release gate was rerun:

- Legacy and schema manifests now share granular derived-file exclusions; the
  resolved v0.6.x card directories remain scannable in non-Git mode. A real
  legacy manifest without `schema` detects a newly created
  `.pmem/modules/module.new.md`, reports it once as `new_card`, and sets
  `needs_rebuild: true`.
- `doctor` now compares canonical source files with live (`is_deleted = 0`)
  indexed rows. A source-card project whose database contains only tombstones
  reports `card_index: warn`, names the tombstone count, and recommends rebuild
  instead of claiming `0 active card(s)` is healthy.
- Targeted status/doctor coverage passed 10/10. The final full suite passed
  429/429 with TypeScript build success, and all ten release E2E journeys passed
  again.
- Live semantic evaluation remained unchanged at Recall@5 `0.95`, MRR
  `0.865414`, exact success `60/60`, 12/12 OOD abstentions, and 300-card p95
  `7.939 ms`.
- Both package dry-runs, registry-state tests, `git diff --check`, and audits
  passed their release policies: root 0 high/critical (2 moderate); companion
  accepted isolated baseline 5 high/0 critical with no new advisory or fix.

No staging, commit, push, issue closure, tag, publish, or pull request was
performed. The branch remains local pending the user's next review decision.

## Delivery Authorization — 2026-07-25

The user accepted the repaired review blockers and explicitly authorized the
complete delivery transaction: commit the v1.2.1 scope, push the feature branch,
open and merge the PR, close Issues #19 through #28 through the merged PR, and
follow the main-branch automation until both npm packages and the GitHub v1.2.1
Release are publicly visible. Do not declare the release complete from a merge
or an in-progress workflow alone; verify the final workflow conclusion and the
public registry read side.
