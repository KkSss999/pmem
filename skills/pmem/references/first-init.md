# First-Time Project Setup

## Step 1: Install pmem globally

```bash
npm install -g pmem-ai
pmem --version
```

## Step 2: Install agent skills

```bash
pmem install --skills --claude    # for Claude Code
pmem install --skills --codex     # for Codex
pmem install --skills --all       # for all detected agents
```

## Step 3: Initialize project memory

Non-interactive (recommended for agents):

```bash
cd your-project
pmem init your-project --guided \
  --description "A web application" \
  --stage "Alpha development" \
  --next "Set up project structure"
pmem rebuild
```

Or with a JSON answers file:

```bash
cat > pmem-init.json <<'JSON'
{
  "description": "A web application",
  "stage": "Alpha development",
  "next": "Set up project structure"
}
JSON
pmem init your-project --answers pmem-init.json
pmem rebuild
```

Interactive (for humans):

```bash
pmem init your-project --guided
# Answers 3 questions in TTY
```

## Step 4: Create your first memory card

```bash
mkdir -p .pmem/modules src

cat > .pmem/modules/core.md <<'CARD'
---
id: module.core
type: module
status: active
tags: [core]
aliases: [main, entry]
source_files: [src/index.ts]
---
# Core Module

## Purpose
Main application entry point.

## Key Behavior
- Initializes the app
- Loads configuration
CARD

echo "export const app = { name: 'my-app' };" > src/index.ts
pmem rebuild
```

## Step 5: Verify setup

```bash
pmem doctor
pmem recall --format compact --budget 2000
pmem verify
```

## Next: try a full session workflow

See [session-workflow.md](session-workflow.md) for the complete agent workflow.
