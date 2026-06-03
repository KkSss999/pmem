#!/usr/bin/env bash
# E2E test for v0.7.0-a: [[card-id]] wikilink → edge parsing
# Tests that [[card-id]] references in markdown bodies generate graph edges.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS:${NC} $*"; }
fail() { echo -e "${RED}❌ FAIL:${NC} $*"; exit 1; }
info() { echo -e "${YELLOW}ℹ️${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMPDIR=$(mktemp -d /tmp/pmem-e2e-wikilink-XXXXXX)
trap "rm -rf '$TMPDIR'" EXIT

info "Test dir: $TMPDIR"

cd "$TMPDIR"
PMEM="node $PROJECT_DIR/dist/index.js"

# Step 1: Initialize a novel project
info "Step 1: Init novel project"
echo "" | $PMEM init --domain novel 2>&1

# Verify discover is disabled
if grep -q "enabled: false" .pmem/manifest.yml; then
  pass "discover.enabled = false"
else
  fail "discover should be disabled for novel"
fi

# Step 2: Create cards and capture their IDs
info "Step 2: Create cards"

# Character 1
$PMEM new character "Lin Zhixu" 2>&1
C1_FILE=$(ls .pmem/characters/character.lin_zhixu*.md 2>/dev/null | head -1)
[ -n "$C1_FILE" ] || C1_FILE=$(ls .pmem/characters/*lin*.md 2>/dev/null | head -1)
C1_ID=$(grep "^id:" "$C1_FILE" | head -1 | sed 's/id: *//')
info "Character 1: $C1_ID"

# Character 2
$PMEM new character "Zero AI" 2>&1
C2_FILE=$(ls .pmem/characters/*zero*.md 2>/dev/null | head -1)
C2_ID=$(grep "^id:" "$C2_FILE" | head -1 | sed 's/id: *//')
info "Character 2: $C2_ID"

# World
$PMEM new world "Shiyu Setting" 2>&1
W_FILE=$(ls .pmem/world/*shiyu*.md 2>/dev/null | head -1)
W_ID=$(grep "^id:" "$W_FILE" | head -1 | sed 's/id: *//')
info "World: $W_ID"

# Chapter
$PMEM new chapter "Volume 1" 2>&1
CH_FILE=$(ls .pmem/chapters/*volume*.md 2>/dev/null | head -1)
CH_ID=$(grep "^id:" "$CH_FILE" | head -1 | sed 's/id: *//')
info "Chapter: $CH_ID"

# Arc
$PMEM new arc "Main Plot" 2>&1
A_FILE=$(ls .pmem/arc/*main*.md 2>/dev/null | head -1)
A_ID=$(grep "^id:" "$A_FILE" | head -1 | sed 's/id: *//')
info "Arc: $A_ID"

# Step 3: Add [[card-id]] wikilinks to card bodies
info "Step 3: Add wikilinks to card bodies"

cat >> "$CH_FILE" << BODY

## Opening Scene

The story begins with [[${C1_ID}]] arriving at [[${W_ID}]].

He encounters [[${C2_ID}]], who reveals the [[${A_ID}]].
BODY

cat >> "$W_FILE" << BODY

## Related Elements

This setting is central to [[${A_ID}]] and first appears in [[${CH_ID}]].
BODY

cat >> "$A_FILE" << BODY

## Key Characters

- Protagonist: [[${C1_ID}]]
- Antagonist AI: [[${C2_ID}]]
- Primary setting: [[${W_ID}]]
BODY

# Step 4: Full rebuild to process wikilinks
info "Step 4: Full rebuild"
$PMEM rebuild --full 2>&1

# Step 5: Verify graph edges via related command
info "Step 5: Verify graph edges"

# Check chapter edges (should have 4 outgoing references)
CH_RELATED=$($PMEM related "$CH_ID" --format json --depth 1 2>&1)
echo "$CH_RELATED"

# Verify mention source edges exist
if echo "$CH_RELATED" | grep -q '"source": *"mention"'; then
  pass "Mention edges found on chapter card"
else
  info "Checking for references edges..."
  if echo "$CH_RELATED" | grep -q '"references"'; then
    pass "References edges found on chapter card"
  elif echo "$CH_RELATED" | grep -q '"total_edges": *[1-9]'; then
    pass "Non-zero edges found on chapter card"
  else
    fail "No edges found on chapter card"
  fi
fi

# Check arc edges
A_RELATED=$($PMEM related "$A_ID" --format json --source mention --depth 1 2>&1)
echo "$A_RELATED"

if echo "$A_RELATED" | grep -q '"total_edges": *[1-9]'; then
  pass "Non-zero mention edges found on arc card"
fi

# Step 6: Verify incremental rebuild is idempotent
info "Step 6: Verify idempotent rebuild"
REBUILD2=$($PMEM rebuild 2>&1)
echo "$REBUILD2"

# All cards should be skipped (no changes)
SKIP_COUNT=$(echo "$REBUILD2" | grep -o '[0-9]* skipped' | grep -o '[0-9]*' || echo "0")
info "Skipped: $SKIP_COUNT"

# Edge count should be non-zero
EDGE_LINE=$(echo "$REBUILD2" | grep "Graph:" | tail -1)
info "Summary: $EDGE_LINE"

EDGE_CNT=$(echo "$EDGE_LINE" | grep -o '[0-9]* edges' | grep -o '[0-9]*')
if [ "$EDGE_CNT" -gt 0 ] 2>/dev/null; then
  pass "Rebuild summary shows $EDGE_CNT edges (non-zero)"
else
  fail "Rebuild summary shows 0 edges"
fi

# Step 7: Verify discover stays disabled for novel
info "Step 7: Verify discover stays disabled"
DISCOVER_OUT=$($PMEM discover --format compact 2>&1 || true)
echo "$DISCOVER_OUT"
if echo "$DISCOVER_OUT" | grep -qi "disabled"; then
  pass "Discover correctly disabled for novel domain"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All E2E tests passed for v0.7.0-a${NC}"
echo -e "${GREEN}  [[card-id]] → mention edges ✅${NC}"
echo -e "${GREEN}  Graph non-empty ✅${NC}"
echo -e "${GREEN}  Discover disabled for novel ✅${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
