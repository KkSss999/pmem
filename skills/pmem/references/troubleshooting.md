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
```

## Run a full diagnostic

```bash
pmem doctor
pmem doctor --format json
```

Checks: `.pmem/` directory, manifest, database health, card count, dirty flags, active session, git availability, integrations.
