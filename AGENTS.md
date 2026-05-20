# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with this repository.

## Project Overview

`pmem` is **Project Memory for AI Agents**: a local CLI runtime that lets coding agents recover project context, query graph-guided memory, detect changed files, suggest memory updates, and verify consistency.

Current development track: **v0.5 Productization Beta**.

v0.4 already completed the runtime loop:

```txt
recall / ask -> code changes -> status -> mark-dirty -> update suggest/confirm -> distill -> verify
```

v0.5 does not add embedding, MCP/REST, Graph UI, telemetry, or remote services. Its goal is to make the existing runtime installable, understandable, testable, and publishable as a Beta CLI product.

## Commands

```bash
npm run build          # TypeScript -> dist/
npm run dev            # ts-node src/index.ts
npm run start          # node dist/index.js
npm test               # node:test suite for src/core/*.test.ts
```

TypeScript is strict mode, CommonJS output, target ES2022. Runtime target is Node.js >=18.

## Current v0.5 Priorities

1. README and quick start
2. npm package readiness
3. install smoke E2E
4. real project workflow E2E
5. AGENTS / CLAUDE / integration template sync
6. error UX and exit code documentation
7. CHANGELOG and release checklist

See [docs/v0.5 pre-design.md](docs/v0.5%20pre-design.md) for scope and acceptance criteria.

## Testing

Use `temp/` for all pmem manual and E2E testing. This directory is gitignored, so `pmem init` and `.pmem/` artifacts created there will not pollute the repository.

```bash
cd temp && rm -rf v05-test && mkdir v05-test && cd v05-test
npx ts-node ../../src/index.ts init v05-test
npx ts-node ../../src/index.ts rebuild
npx ts-node ../../src/index.ts recall --format compact --budget 2000
npx ts-node ../../src/index.ts verify
```

For workflow testing, add a card with `source_files`, then run:

```bash
npx ts-node ../../src/index.ts status --format json
npx ts-node ../../src/index.ts mark-dirty --auto
npx ts-node ../../src/index.ts update --suggest --format json
npx ts-node ../../src/index.ts update --confirm -s "summary" -n "next"
npx ts-node ../../src/index.ts verify
```

## Architecture

**Core data principle:** `.pmem/**/*.md` Markdown cards with YAML frontmatter are the single source of truth.

Runtime/cache layers:

- `.pmem/pmem.db` is the primary SQLite index and runtime state store.
- `.pmem/indexes/*.json` are legacy/generated caches retained for compatibility.
- All indexes are rebuildable from Markdown cards and must not become the only source of any card.

Never create database-only cards. Never directly edit SQLite as the authoritative memory update path. Update Markdown cards or use CLI workflow commands, then rebuild.

## Source Tree

```txt
src/
  index.ts                     CLI entry (Commander), versioned CLI commands
  types.ts                     All TS types, including ManifestV02 | ManifestV03
  core/
    fs.ts                      File helpers: atomicWrite, locks, read/write/list
    manifest.ts                Manifest YAML load/save via js-yaml
    db.ts                      SQLite schema, CRUD, dirty flags, sessions, update_log
    hash.ts                    SHA-256 content hashes for file/frontmatter/body
    yaml.ts                    Shared frontmatter parser
    format.ts                  compact/json/paths/pack format helpers
    *.test.ts                  node:test coverage for core behavior
  commands/
    init.ts                    pmem init [--guided], skeleton + integration templates
    rebuild.ts                 pmem rebuild --changed/--full/--card
    recall.ts                  pmem recall --budget N --format compact|json|paths|pack
    ask.ts                     pmem ask <query>, exact/alias/tag/graph/FTS/rerank flow
    graph.ts                   pmem related / pmem trace
    status.ts                  pmem status, git/mtime change detection + affected cards
    update.ts                  pmem update and mark-dirty workflow
    distill.ts                 pmem distill workflow and suggestions
    verify.ts                  consistency, stale-memory, and freshness checks
    migrate.ts                 schema migration to v0.3
    session.ts                 session start/end and update_log summary
    integration.ts             integration list/install/verify
```

## CLI Reference

```bash
pmem init [project-name] [--guided]

pmem recall [--budget N] [--format compact|json|paths|pack]
pmem ask <query> [--format compact|json|paths|pack]
pmem related <id> [--depth N] [--type <edge-type>]
pmem trace <id>

pmem status [--since <timestamp>] [--format compact|json]
pmem mark-dirty [-r <reason>] [--auto]
pmem update [--auto|--suggest|--apply-suggestion <id>|--confirm|--force] \
  [-s <summary>] [-n <next>] [--format compact|json]

pmem distill [--suggest|--apply-suggestion <id>|--confirm|--suggest-splits]
pmem rebuild [--changed|--full|--card <id>]
pmem verify [--fix]
pmem migrate --to 0.3 [--dry-run] [--backup]
pmem session start [-a <agent-name>]
pmem session end [-s <summary>]
pmem integration list|install <framework>|verify
```

## Exit Codes

| Command | 0 | 1 | 2 |
|---------|---|---|---|
| `pmem status` | changes found | no changes | error |
| `pmem update --suggest` | no suggestions | suggestions found | error |
| `pmem distill --suggest` | no distillation needed | distillation suggested | error |
| `pmem verify` | passed | warnings | errors |

Exit code `1` is often a workflow signal, not a failure.

## Key Design Rules

1. Markdown cards are the only source of truth.
2. SQLite is a generated index/runtime state layer, not an independent card store.
3. JSON indexes are legacy/generated caches and must remain rebuildable.
4. `pmem ask` should stay explainable and graph-guided.
5. Agent workflow is confirmation-first: detect, suggest, confirm/apply, rebuild, verify.
6. Manifest typing is a discriminated union. Narrow on `manifest.pmem.schema_version` before reading version-specific fields.
7. Avoid `as any`; extend types instead.
8. Keep v0.5 focused on productization. Do not add postponed systems unless the v0.5 design is explicitly revised.

## Recommended Reading

1. [README.md](README.md)
2. [docs/v0.5 pre-design.md](docs/v0.5%20pre-design.md)
3. [docs/handover-v0.4.md](docs/handover-v0.4.md)
4. [docs/v0.4 pre-design.md](docs/v0.4%20pre-design.md)
5. [docs/v0.3 pre-design.md](docs/v0.3%20pre-design.md)
6. [src/types.ts](src/types.ts)
7. [src/core/db.ts](src/core/db.ts)
8. [src/commands/update.ts](src/commands/update.ts)
9. [src/commands/status.ts](src/commands/status.ts)
