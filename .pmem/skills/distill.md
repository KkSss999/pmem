# Skill: Distill Memory

Use this to consolidate traces into stable memory cards.

## When to Distill
- After completing a milestone
- When traces/ has accumulated 10+ undistilled entries
- Weekly, as part of project maintenance

## Steps
1. Run `pmem distill` to see suggestions (dry-run).
2. Review the suggested updates for each target card.
3. Run `pmem distill --confirm` to apply.
4. Run `pmem rebuild` to update indexes.
5. Run `pmem verify` to check consistency.
   - If `active_lock` appears, wait a few seconds and re-run — another pmem process is rebuilding.

## What Gets Distilled
- Trace summaries are added to their related module/decision/task cards.
- Traces are marked as distilled in their frontmatter.
- Original trace files are preserved for evidence.

## Split Suggestions
Run `pmem distill --suggest-splits` to detect oversized cards.
