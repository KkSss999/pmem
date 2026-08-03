# Troubleshooting

## No `.pmem` directory

```bash
pmem init <project-name>
```

## `.pmem/pmem.db` missing or corrupted

```bash
# Missing: rebuild from cards
pmem rebuild

# Corrupted: back up and full rebuild
mv .pmem/pmem.db .pmem/pmem.db.bak
pmem rebuild --full
```

## `pmem ask` returns no results

```bash
# Get full project overview
pmem recall --budget 2000

# Check what cards exist
pmem doctor

# Add relevant aliases and tags to existing cards
# Then rebuild
pmem rebuild
```

Fresh v1.2 projects create the first index during `pmem init`; use this command to recover a deleted index or upgrade an older project.

## Semantic companion is missing

The base CLI remains healthy; only optional semantic commands need the
companion. On macOS, install the matching release and enable it for the current
project:

```bash
npm install -g pmem-ai-semantic@1.3.2
pmem semantic enable
pmem semantic status
```

The model is stored once under `~/.pmem-global/models`. Do not copy it into the
project. If semantic setup or indexing fails, `pmem ask`, `context`, and
`recall` continue through deterministic retrieval.

## Not a git repository

`pmem status` and `pmem mark-dirty --auto` use git by default. Outside git repos, they fall back to mtime scanning:

```bash
pmem status --format json
# → "source": "mtime" (fallback active)
```

Initialize git if needed: `git init`

## Dirty flags remain unresolved

```bash
pmem update --suggest
pmem update --confirm -s "<summary>" -n "<next step>"
pmem verify

# OR use the sync shortcut:
pmem sync -s "<summary>" -n "<next step>"
```

## Stale memory verification warnings (Verify Score: 0/100)

If `pmem verify` complains that cards are stale due to code/manifest changes, run:

```bash
pmem verify --fix
# Or specifically fix stale card mtime stamps:
pmem verify --fix-stale
```
This automatically updates their `last_verified` metadata and clears the stale warnings.

## Run a full diagnostic

```bash
pmem doctor
pmem doctor --format json
```

Checks: `.pmem/` directory, manifest, database health, card count, dirty flags, active session, git availability, integrations.
