#!/usr/bin/env bash
# E2E test for v0.7 novel preset validation.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/temp/e2e-v07-novel"
PMEM=(node "$ROOT/dist/index.js")

echo "=== Running E2E for Novel preset ==="

rm -rf "$PROJECT"
mkdir -p "$PROJECT"

cd "$ROOT"
npm run build >/dev/null

cd "$PROJECT"
git init -q
git config user.email "pmem-e2e@example.com"
git config user.name "pmem e2e"

# Initialize with novel preset
"${PMEM[@]}" init my-novel \
  --domain novel \
  --guided \
  --description "A story about time travelers" \
  --stage "Drafting" \
  --next "Write the first meeting" \
  >/dev/null

echo "  PASS: init novel preset succeeded"

# Check directories
for dir in characters chapters world arc decisions traces; do
  if [[ ! -d ".pmem/$dir" ]]; then
    echo "  FAIL: Directory .pmem/$dir is missing!"
    exit 1
  fi
done
echo "  PASS: all directories created successfully"

# Check manifest configuration schema
if ! grep -q "domain: novel" .pmem/manifest.yml; then
  echo "  FAIL: manifest.yml project.domain is not 'novel'!"
  exit 1
fi
if ! grep -q "character" .pmem/manifest.yml; then
  echo "  FAIL: manifest.yml schema is missing 'character'!"
  exit 1
fi
echo "  PASS: manifest schema fields written successfully"

# Create a new character card
"${PMEM[@]}" new character "张三" >/dev/null
CHAR_CARD=$(find .pmem/characters -name "character.*.md")
if [[ -z "$CHAR_CARD" ]]; then
  echo "  FAIL: character card was not written to .pmem/characters/!"
  exit 1
fi
echo "  PASS: new character card created successfully in characters/"

# Create a new chapter card
"${PMEM[@]}" new chapter "Chapter 1" >/dev/null
CHAP_CARD=$(find .pmem/chapters -name "chapter.*.md")
if [[ -z "$CHAP_CARD" ]]; then
  echo "  FAIL: chapter card was not written to .pmem/chapters/!"
  exit 1
fi
echo "  PASS: new chapter card created successfully in chapters/"

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

# 1. Verify pmem ask "张三"
ASK_OUTPUT=$("${PMEM[@]}" ask "张三")
if ! echo "$ASK_OUTPUT" | grep -q "character._"; then
  echo "  FAIL: pmem ask '张三' did not find the character!"
  echo "$ASK_OUTPUT"
  exit 1
fi
echo "  PASS: pmem ask '张三' successfully found the character"

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
if ! echo "$RECALL_JSON" | grep -q "character._"; then
  echo "  FAIL: recall JSON does not contain character card!"
  exit 1
fi
if ! echo "$RECALL_JSON" | grep -q "chapter.chapter_1"; then
  echo "  FAIL: recall JSON does not contain chapter card!"
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
echo "  PASS: discover is disabled for novel domain"

echo "=== Novel E2E completed successfully! ==="
