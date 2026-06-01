#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v061-suggest"
PMEM=(node "$ROOT/dist/index.js")

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"

PASSED=0
FAILED=0

pass() { echo "  PASS: $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAILED=$((FAILED + 1)); }

# ── Setup ──────────────────────────────────────────────

"${PMEM[@]}" init e2e-v061-suggest --guided --description "E2E test" --stage "Testing" --next "Verify" >/dev/null

mkdir -p src .pmem/modules
cat > src/main.ts <<'SRC'
export const version = 1;
SRC

cat > .pmem/modules/core.md <<'CARD'
---
id: module.core
type: module
status: active
source_files:
  - src/main.ts
created: 2026-05-20
---

# Core

Test module for v0.6.1 E2E.
CARD

git add -A
git commit -q -m "baseline"
"${PMEM[@]}" rebuild >/dev/null

# ── Test 1: Duplicate aggregation ──────────────────────

echo "=== Test 1: Duplicate aggregation ==="

# Create multiple dirty flags for the same card+file
for i in 1 2 3; do
  echo "// version $i" > src/main.ts
  "${PMEM[@]}" mark-dirty --auto >/dev/null
done

set +e
JSON="$("${PMEM[@]}" update --suggest --format json 2>&1)"
CODE="$?"
set -e

if echo "$JSON" | grep -q '"count": 3'; then
  pass "dirty flags aggregated with count 3"
else
  fail "dirty flags not aggregated" "expected count 3 in JSON"
fi

if echo "$JSON" | grep -q '"duplicates_hidden": 2'; then
  pass "duplicates_hidden is 2"
else
  fail "duplicates_hidden wrong" "expected 2"
fi

if echo "$JSON" | grep -q '"is_duplicate": true'; then
  pass "is_duplicate is true"
else
  fail "is_duplicate false" "expected true for aggregated group"
fi

if [[ "$CODE" == "0" ]]; then
  pass "exit code 0 (v0.6.2: normal result, has suggestions)"
else
  fail "exit code wrong" "expected 0, got $CODE"
fi

# ── Test 2: Verify alignment (no blocking after freshness aligned) ──

echo "=== Test 2: Verify alignment ==="

# v0.6.4 fix: `update --confirm` resolves only project-level dirty flags,
# NOT per-card flags (scope=card).  They persist until explicitly resolved.
# And `rebuild` (incremental) skips cards whose hashes match, so card.updated_at
# stays stale and checkStaleMemory() keeps flagging "blocking".
#
# To align freshness: touch the card's `updated` frontmatter field to today,
# so the hash changes → card is re-upserted with a recent updated_at →
# checkStaleMemory() sees a fresh card → blocking disappears.
sed -i '' 's/^created: 2026-05-20/created: 2026-05-20\nupdated: 2999-01-01T00:00:00Z/' .pmem/modules/core.md
"${PMEM[@]}" rebuild >/dev/null

set +e
"${PMEM[@]}" verify >/dev/null 2>&1
# Re-fetch fresh JSON — do NOT reuse Test 1's stale $JSON.
JSON="$("${PMEM[@]}" update --suggest --format json 2>&1)"
COMPACT="$("${PMEM[@]}" update --suggest --format compact 2>&1)"
CODE="$?"
set -e

# After freshness-aligned rebuild, checkStaleMemory returns nothing
# for this card, so the per-card flags from Test 1 appear as
# non-blocking current suggestions, or (if all resolved) clean output.
if echo "$COMPACT" | grep -qE "(No blocking|no blocking|no longer any)"; then
  pass "compact says no blocking issues"
else
  fail "compact missing no-blocking message" "$COMPACT"
fi

if echo "$JSON" | grep -q '"verify_blocking": false'; then
  pass "json verify_blocking is false"
else
  fail "verify_blocking should be false" ""
fi

# Current (non-blocking) suggestions should not claim blocks_verify.
# If there are no suggestions at all the key may be absent — that is also fine.
# Use `! grep -q` (not `grep -qv`) because grep -qv inverts per-line:
# it succeeds if ANY line lacks the pattern, which is a false positive
# on multi-line JSON.
if ! echo "$JSON" | grep -q '"blocks_verify": true'; then
  pass "blocks_verify is false (or absent) for non-blocking item"
else
  fail "blocks_verify should be false" ""
fi

# ── Test 3: Hidden historical with --include-history   ──

echo "=== Test 3: Hidden historical and --include-history ==="

# Test 2 aligned freshness.  Now create a session-scoped dirty flag:
# 1. Start session
# 2. Modify source file → mtime is now newer than card.updated_at
# 3. mark-dirty --auto → creates per-card flag (blocking, because
#    checkStaleMemory re-detects the stale file)
# 4. End the session
# 5. Re-align freshness (update card frontmatter → rebuild) so
#    checkStaleMemory() returns nothing, and the flag drops from
#    "blocking" to "warning / historical" (tied to ended session)

"${PMEM[@]}" session start -a "test-agent" >/dev/null
echo "// historical version" > src/main.ts
"${PMEM[@]}" mark-dirty --auto >/dev/null
"${PMEM[@]}" session end -s "session done" >/dev/null

# Re-align freshness: touch card frontmatter to be even newer, then
# incremental rebuild (preserves dirty_flags, updates card.updated_at).
sed -i '' 's/^updated: 2999-01-01T00:00:00Z/updated: 2999-01-02T00:00:00Z/' .pmem/modules/core.md
"${PMEM[@]}" rebuild >/dev/null

# After freshness-aligned rebuild, the remaining unfired dirty flag
# is non-blocking (checkStaleMemory sees aligned timestamps) and
# historical (flag created during a now-ended session).
set +e
HIST_COMPACT="$("${PMEM[@]}" update --suggest --format compact 2>&1)"
HIST_CODE="$?"
set -e

if echo "$HIST_COMPACT" | grep -q "Historical hidden"; then
  pass "historical hidden counter shown"
else
  fail "historical hidden counter missing" "$HIST_COMPACT"
fi

if [[ "$HIST_CODE" == "0" ]]; then
  pass "only historical items — exit code 0"
else
  fail "exit code wrong for historical-only" "expected 0, got $HIST_CODE"
fi

# Now test --include-history
set +e
INCL_COMPACT="$("${PMEM[@]}" update --suggest --format compact --include-history 2>&1)"
INCL_CODE="$?"
set -e

if echo "$INCL_COMPACT" | grep -q "Historical:"; then
  pass "--include-history shows historical section"
else
  fail "--include-history missing historical section" "$INCL_COMPACT"
fi

set +e
INCL_JSON="$("${PMEM[@]}" update --suggest --format json --include-history 2>&1)"
set -e

if echo "$INCL_JSON" | grep -q '"is_historical": true'; then
  pass "--include-history json has is_historical: true"
else
  fail "--include-history json missing is_historical" ""
fi

if echo "$INCL_JSON" | grep -q '"severity": "warning"'; then
  pass "non-blocking item has severity warning"
else
  fail "severity field wrong or missing" ""
fi

# ── Test 4: Missing DB exits 2 ─────────────────────────

echo "=== Test 4: Missing DB exits 2 ==="

# Create a separate project where we can safely delete the DB
MDB="$ROOT/temp/e2e-v061-missing-db"
rm -rf "$MDB"
mkdir -p "$MDB"
cd "$MDB"
git init -q
"${PMEM[@]}" init missing-db --guided --description "x" --stage "y" --next "z" >/dev/null
rm -f .pmem/pmem.db

set +e
MDB_OUT="$("${PMEM[@]}" update --suggest --format compact 2>&1)"
MDB_CODE="$?"
set -e

if [[ "$MDB_CODE" == "2" ]]; then
  pass "missing DB exits 2"
else
  fail "missing DB exit code wrong" "expected 2, got $MDB_CODE"
fi

if echo "$MDB_OUT" | grep -q "pmem rebuild"; then
  pass "missing DB message suggests rebuild"
else
  fail "missing DB message wrong" "$MDB_OUT"
fi

# ── Test 5: Blocking group returns 1 ────────────────────

echo "=== Test 5: Blocking group returns 1 ==="

cd "$PROJECT"

# Create a fresh card with source_files, then modify the file without updating the card
cat > .pmem/modules/stale-card.md <<'CARD'
---
id: module.stale_test
type: module
status: active
source_files:
  - src/stale.ts
created: 2020-01-01
updated: 2020-01-01
last_verified: 2020-01-01
---

# Stale Test

This card is intentionally very old.
CARD

cat > src/stale.ts <<'SRC'
export const stale = true;
SRC

git add -A
git commit -q -m "setup stale test"
"${PMEM[@]}" rebuild >/dev/null

# Modify the source file to trigger stale detection
echo "export const stale = false;" > src/stale.ts
"${PMEM[@]}" mark-dirty --auto >/dev/null

set +e
BLOCK_JSON="$("${PMEM[@]}" update --suggest --format json 2>&1)"
BLOCK_CODE="$?"
set -e

if echo "$BLOCK_JSON" | grep -q '"blocking_for_verify"'; then
  pass "json has blocking_for_verify group"
else
  fail "json missing blocking_for_verify" ""
fi

if echo "$BLOCK_JSON" | grep -q '"severity": "blocking"'; then
  pass "blocking item has severity: blocking"
else
  fail "blocking item missing correct severity" ""
fi

if echo "$BLOCK_JSON" | grep -q '"blocks_verify": true'; then
  pass "blocking item has blocks_verify: true"
else
  fail "blocking item missing blocks_verify true" ""
fi

if [[ "$BLOCK_CODE" == "0" ]]; then
  pass "blocking present — exit code 0 (v0.6.2 normal)"
else
  fail "blocking exit code wrong" "expected 0, got $BLOCK_CODE"
fi

# ── Summary ─────────────────────────────────────────────

echo ""
echo "========== v0.6.1 Suggest E2E Results =========="
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  echo "v0.6.1 suggest E2E FAILED"
  exit 1
fi

echo "v0.6.1 suggest E2E passed"
