# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`pmem` is a CLI tool implementing the **Project Memory protocol** — a graph-based memory runtime for AI coding agents. It gives agents minimal-token project context (where am I, what's the state, what's next, why) via a `.pmem/` directory of Markdown memory cards plus derived graph indexes.

## Commands

```bash
npm run build          # TypeScript → dist/
npm run dev            # ts-node direct run
npm run start          # node dist/index.js
```

TypeScript is strict mode, CommonJS output, target ES2022.

## Testing

Use `temp/` for all pmem testing. This directory is gitignored, so `pmem init` or `.pmem/` artifacts created there won't pollute the repo.

```bash
cd temp && mkdir test-project && cd test-project
npx ts-node ../../src/index.ts init test-project
npx ts-node ../../src/index.ts rebuild
```

## Architecture

**Core data principle:** `.pmem/**/*.md` Markdown cards (with YAML frontmatter) are the single source of truth. `indexes/graph.json` and `indexes/bm25.json` are derived caches — rebuildable from cards, never edited manually.

**Source tree:**
```
src/
  index.ts                     CLI entry (Commander) — wires 13 commands
  types.ts                     All TS types (CardFrontmatter, GraphNode, GraphIndex, Manifest, v0.2 types, etc.)
  core/
    fs.ts                      File system helpers (read, write, ensureDir, listFiles, atomicWrite, acquireLock, etc.)
    manifest.ts                Manifest YAML serialize/parse via js-yaml, default v0.2 manifest template
  commands/
    init.ts                    pmem init [--guided] — generate .pmem/ skeleton + AGENTS.md + candidates/
    rebuild.ts                 pmem rebuild — parse .md frontmatter → indexes/graph.json (atomicWrite)
    recall.ts                  pmem recall --budget N — output minimal project context
    verify.ts                  pmem verify --fix — schema_version + card_policy + index consistency
    ask.ts                     pmem ask <query> — exact match → graph expand → BM25 fallback
    graph.ts                   pmem related <id> / pmem trace <id>
    update.ts                  pmem update / pmem mark-dirty — four-level update flow (atomicWrite + file lock)
    integration.ts             pmem integration list/install/verify
    migrate.ts                 pmem migrate --dry-run/--to/--backup — schema version migration
    distill.ts                 pmem distill [--confirm] [--suggest-splits] — trace → card distillation
```

**Note:** `manifest.ts` uses `js-yaml` for YAML serialization/parsing (replaced the v0.1 custom parser).

**Key design rules (from docs/Voorlopige projekidee.md):**
1. Markdown cards are the source of truth
2. Graph indexes are generated caches (rebuildable)
3. `pmem ask` must be explainable and graph-guided (exact match → neighbors → keyword fallback)
4. Agent update flow: `mark-dirty → auto-detect → confirm → write` — never auto-write traces without meaningful change
5. Graph storage mode is abstracted (v0.1 single file, future sharded/sqlite)
6. `AGENTS.md` is entry instruction, `skills/` are pmem workflows, `integrations/` are framework adapters

**Memory update levels:** `mark-dirty` (flag only) → `update --auto` (detect + suggest) → `update --confirm` (write) → `update --force` (force write).

**Token budget recall:** Hot memory (index/state/next, ~1000-2000 tokens), Warm memory (modules/decisions/tasks, on-demand), Cold memory (traces/summaries, evidence-only).

**Concurrency (v0.2):** File-basic mode — atomicWrite (.tmp → fsync → rename) + simple file lock (mkdir-based, 3s timeout, abort on conflict). Optimistic lock deferred to v0.3 SQLite.

## Implementation Status

v0.1 and v0.2 are complete. All commands are implemented and tested:

| Command | v0.1 | v0.2 |
|---------|------|------|
| `pmem init` | Done | Enhanced: `--guided` mode, project scanning, `candidates/`, `memory_incomplete` |
| `pmem rebuild` | Done | Enhanced: atomicWrite (writeJson) |
| `pmem recall` | Done | — |
| `pmem verify` | Done | Enhanced: schema_version check, card_policy validation, dirty detection |
| `pmem ask` | Done | — |
| `pmem related` | Done | — |
| `pmem trace` | Done | — |
| `pmem update` | Done | Enhanced: atomicWrite, file lock, manifest.memory_status |
| `pmem mark-dirty` | Done | Enhanced: atomicWrite, manifest.memory_status |
| `pmem integration` | Done | Enhanced: distill in templates |
| `pmem migrate` | — | **New**: `--dry-run`, `--to`, `--backup`, 0.1→0.2 migration path |
| `pmem distill` | — | **New**: trace → card distillation, `--confirm`, `--suggest-splits` |

**Key v0.2 additions:** js-yaml dependency, atomicWrite, file lock (mkdir-based), schema_version management, migration with auto-backup, guided init with project scanning.

**Next:** v0.3 — SQLite-backed CLI Runtime (see `docs/v0.3 pre-design.md`).

## Design Documents

- `docs/Voorlopige projekidee.md` — Full architecture specification, manifest schema, card format, CLI design, long-term roadmap
- `docs/prd.md` — Product Requirements Document (vision, users, features, architecture, success criteria)
- `docs/project-roadmap.md` — v0.1 through v0.5 full roadmap with themes, deliverables, migration paths
- `docs/v0.2 pre-design.md` — Resolved design decisions for 4 questions (cold start, concurrency, card granularity, version migration)
- `docs/v0.2 pre-roadmap.md` — v0.2 target architecture, P0/P1/P2 priorities, revised manifest, implementation phases
- `docs/v0.3 pre-design.md` — v0.3 SQLite-backed CLI Runtime design (schema, migration, output contract, rebuild strategy)
- `docs/handover-v0.3.md` — v0.3 onboarding guide for new developers (step-by-step, acceptance criteria, pitfalls)
