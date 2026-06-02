#!/usr/bin/env bash
# E2E test for v0.7 research preset validation.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v07-research"
PMEM=(node "$ROOT/dist/index.js")

echo "=== Running E2E for Research preset ==="

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"

# Initialize with research preset
"${PMEM[@]}" init my-research \
  --domain research \
  --guided \
  --description "Research on climate models" \
  --stage "Reviewing Literature" \
  --next "Review Paper A" \
  >/dev/null

echo "  PASS: init research preset succeeded"

# Check directories
for dir in sources claims notes experiments decisions traces; do
  if [[ ! -d ".pmem/$dir" ]]; then
    echo "  FAIL: Directory .pmem/$dir is missing!"
    exit 1
  fi
done
echo "  PASS: all directories created successfully"

# Check manifest configuration schema
if ! grep -q "domain: research" .pmem/manifest.yml; then
  echo "  FAIL: manifest.yml project.domain is not 'research'!"
  exit 1
fi
if ! grep -q "source" .pmem/manifest.yml; then
  echo "  FAIL: manifest.yml schema is missing 'source'!"
  exit 1
fi
echo "  PASS: manifest schema fields written successfully"

# Create a new source card
"${PMEM[@]}" new source "Paper A" >/dev/null
SRC_CARD=$(find .pmem/sources -name "source.*.md")
if [[ -z "$SRC_CARD" ]]; then
  echo "  FAIL: source card was not written to .pmem/sources/!"
  exit 1
fi
echo "  PASS: new source card created successfully in sources/"

# Create a new claim card
"${PMEM[@]}" new claim "Main claim" >/dev/null
CLAIM_CARD=$(find .pmem/claims -name "claim.*.md")
if [[ -z "$CLAIM_CARD" ]]; then
  echo "  FAIL: claim card was not written to .pmem/claims/!"
  exit 1
fi
echo "  PASS: new claim card created successfully in claims/"

# Run rebuild to index cards
"${PMEM[@]}" rebuild >/dev/null
echo "  PASS: pmem rebuild completed"

# Run verify
set +e
VERIFY_OUTPUT=$("${PMEM[@]}" verify)
VERIFY_CODE=$?
set -e

if [[ "$VERIFY_CODE" != "0" ]]; then
  echo "  FAIL: pmem verify failed with exit code $VERIFY_CODE"
  echo "$VERIFY_OUTPUT"
  exit 1
fi
echo "  PASS: pmem verify succeeded"

# 1. Verify pmem ask "Paper A"
ASK_OUTPUT=$("${PMEM[@]}" ask "Paper A")
if ! echo "$ASK_OUTPUT" | grep -q "source.paper_a"; then
  echo "  FAIL: pmem ask 'Paper A' did not find the source!"
  echo "$ASK_OUTPUT"
  exit 1
fi
echo "  PASS: pmem ask 'Paper A' successfully found the source"

# 2. Verify recall --format json
RECALL_JSON=$("${PMEM[@]}" recall --format json)
if ! echo "$RECALL_JSON" | grep -q '"active_modules"'; then
  echo "  FAIL: recall JSON missing active_modules!"
  exit 1
fi
if ! echo "$RECALL_JSON" | grep -q '"active_foundation"'; then
  echo "  FAIL: recall JSON missing active_foundation!"
  exit 1
fi
if ! echo "$RECALL_JSON" | grep -q "source.paper_a"; then
  echo "  FAIL: recall JSON does not contain source card!"
  exit 1
fi
if ! echo "$RECALL_JSON" | grep -q "claim.main_claim"; then
  echo "  FAIL: recall JSON does not contain claim card!"
  exit 1
fi
echo "  PASS: recall --format json outputs correct active_modules and active_foundation"

# 3. Verify discover output
DISCOVER_OUTPUT=$("${PMEM[@]}" discover)
if [[ "$DISCOVER_OUTPUT" != "discover disabled in this project" ]]; then
  echo "  FAIL: discover did not output disabled text! Output: $DISCOVER_OUTPUT"
  exit 1
fi
DISCOVER_JSON=$("${PMEM[@]}" discover --format json)
if ! echo "$DISCOVER_JSON" | grep -q '"enabled": false'; then
  echo "  FAIL: discover JSON did not report enabled: false!"
  echo "$DISCOVER_JSON"
  exit 1
fi
echo "  PASS: discover is disabled for research domain"

echo "=== Research E2E completed successfully! ==="
