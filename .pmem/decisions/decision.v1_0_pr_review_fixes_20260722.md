---
id: decision.v1_0_pr_review_fixes_20260722
type: decision
title: "v1.0 PR Review Security & Robustness Fixes"
status: active
tags: [v1.0, security, review, sdk, mcp, hardening]
created: "2026-07-22"
updated: "2026-07-22T11:30:00.000Z"
last_verified: "2026-07-22T11:30:00.000Z"
depends_on:
  - decision.pmem_two_layer_architecture_20260722
related_to:
  - feature.v1_0_agentic_memory_runtime_20260722
classification: decision
trust_label: user_confirmed
sensitivity: internal
---

# v1.0 PR Review Security & Robustness Fixes

## Decision

Before merging v1.0 PR #15, a comprehensive 4-agent parallel code review identified 8 issues across HIGH, MEDIUM, and LOW severity tiers. We chose to fix all HIGH and actionable MEDIUM issues before merge.

## What We Fixed

### HIGH
1. **SDK missing type exports** — `src/sdk/index.ts` now exports all 14 types needed for SDK consumers (AskResultV03, AskOptions, RecallQueryResult, ContextQueryResult, RelatedResult, StatusResult, CaptureResult, CaptureOptions, ForgetRequest, RecallOptions, RelatedOptions, StatusOptions, MemoryCard)

2. **Pmem.forget() scope extraction** — `sessionId` now correctly extracted from `session:` scope prefix instead of always null

### MEDIUM
3. **MCP tool schema hardening** — All 8 MCP tools now have `additionalProperties: false`. CAPTURE_TOOL additionally has `validateExactKeys` preventing extra parameter injection.

4. **pmem_observe file path validation** — `validateObserveArgs` now validates the `file` parameter against the project root scope, preventing path injection into the event store.

5. **CLI forget routed through Runtime** — `forgetCommand` now uses `Pmem.open()` → `memory.forget()` instead of direct `openDatabase()`/`forgetMemory()` singleton pattern.

6. **status.ts / context.ts error handling** — Both commands now have try/catch blocks with user-friendly error messages and proper exit code 2 on failure.

## What We Deferred (v1.1)

- Duplicate `RuntimeConfig` type name (breaking change risk)
- Event store ALTER TABLE migration pattern (tech debt)
- MCP rate limiting
- Module/decision inference hardcoded game-project keywords

## Verification

- `npm run build` — clean
- `npm test` — 310/310 passing
- `test:e2e:install` — passed
- `test:e2e:workflow` — passed
