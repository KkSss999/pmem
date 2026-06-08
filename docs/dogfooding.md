# Dogfooding pmem

This guide covers the self-referential patterns that arise when using pmem to manage pmem's own development memory — and the recommended workflows to keep memory clean.

## The Self-Reference Problem

When a project uses pmem as its own project-memory tool, `.pmem/` files play two roles simultaneously:

1. **Memory**: Cards under `.pmem/` describe the project's modules, decisions, tasks, etc.
2. **Memory targets**: Some cards reference `.pmem/` files as `source_files` (e.g., a decision card that lists `.pmem/manifest.yml`).

This creates a feedback loop: every `pmem update --confirm` rewrites `.pmem/manifest.yml`, `.pmem/next.md`, `.pmem/state.md`, and `.pmem/index.md`. If any card lists these files in its `source_files` frontmatter, the next `pmem verify` will flag that card as `stale_memory` — even though the change was purely administrative.

## Expected Self-Stale Patterns

After a normal development session using pmem, you may see these expected stale warnings:

| Card | Source file | Why it appears |
|------|------------|----------------|
| `decision.dogfood_pmem_for_pmem_development` | `.pmem/manifest.yml` | `update --confirm` rewrites manifest to clear dirty state |
| `module.*` cards referencing `.pmem/` | `.pmem/state.md`, `.pmem/next.md` | Session management rewrites these files |

**These are false positives** — the memory content hasn't actually changed. As of v0.7.1+, `.pmem/**` paths are excluded from the `stale_memory` check in `pmem verify`, so you should no longer see these warnings during routine development.

## Recommended Cleanup Cadence

### After each coding session

```bash
pmem verify              # Quick health check
pmem verify --fix-stale  # Refresh any stale cards (source code changes)
```

### After a release

```bash
# 1. Record the milestone
pmem milestone v0.7.5 -m "Web visualization closeout"

# 2. Refresh all stale cards whose source changes you've reviewed
pmem verify --fix-stale

# 3. Update memory with the release summary
pmem sync -s "Released v0.7.5" -n "Plan v0.8.0"

# 4. Verify clean state
pmem verify
```

### Weekly maintenance

```bash
pmem verify --relaxed     # Full check with relaxed token limits
pmem distill --suggest    # Check if traces should be consolidated
pmem doctor               # Overall health diagnostic
```

## Using `--refresh-verified`

When you've reviewed source file changes and want to acknowledge them without creating a new trace for each card:

```bash
# Refresh specific cards after reviewing their source changes
pmem update --confirm \
  -s "Reviewed v0.7.5 changes" \
  -n "Begin v0.7.6" \
  --refresh-verified decision.sqlite_runtime,module.cli_runtime
```

This bumps the `last_verified` timestamp on the specified cards so `pmem verify` knows they've been reviewed.

## Marking Specific Cards Dirty

When you know a specific card needs updating (e.g., you edited its frontmatter directly):

```bash
# Mark individual cards dirty by ID
pmem mark-dirty --card module.core --card decision.jwt_tokens -r "Manual frontmatter edit"
```

This bypasses the git-diff-based `--auto` detection and is useful when you hand-edit `.pmem/` cards directly.

## FAQ

### Q: Why do I get stale_memory warnings after every `pmem update --confirm`?

This was a known issue in v0.7.1 and earlier. The fix (excluding `.pmem/**` paths from stale checks) is included in the current version. If you still see these warnings, run `pmem rebuild --full` and try again.

### Q: How do I clear 19 stale_memory warnings after a big release?

```bash
pmem verify --fix-stale   # One command refreshes all of them
```

### Q: What's the difference between `--fix` and `--fix-stale`?

- `pmem verify --fix` repairs structural index issues (hash mismatches, missing DB, orphan edges).
- `pmem verify --fix-stale` does everything `--fix` does, **plus** refreshes `last_verified` timestamps on stale memory cards.
