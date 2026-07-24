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
pmem install --skills --gemini    # for Gemini
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
```

Fresh projects are indexed during `pmem init`, so `recall`, `ask`, and `context` are ready immediately. `init` does not download a semantic model.

Domain presets (v0.7.0):

```bash
pmem init your-project --domain software   # default; modules/features/tasks
pmem init your-novel --domain novel        # characters/chapters/world/arc
pmem init your-research --domain research  # sources/claims/notes/experiments
```

Use `software` for codebases, `novel` for writing projects, and `research` for literature reviews or evidence-driven notes. Novel and research projects disable `pmem discover` by default to avoid code-scanner noise.

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
```

Interactive (for humans):

```bash
pmem init your-project --guided
# Answers 3 questions in TTY
```

## Step 4: Confirm immediate recall, then create your first memory card

```bash
pmem context "Set up project structure"
```

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

For non-software projects, use the preset card types:

```bash
pmem new character "Main Protagonist"
pmem new chapter "Opening Scene"
pmem new source "Smith 2024 Survey"
pmem new claim "Memory Improves Agent Continuity"
pmem rebuild
```

## Step 5: Verify setup

```bash
pmem doctor
pmem recall --format compact --budget 2000
pmem verify
```

Optional semantic enhancement on macOS is a separate, explicit journey:

```bash
npm install -g pmem-ai-semantic@1.2.0
pmem semantic enable
```

## Next: try a full session workflow

See [session-workflow.md](session-workflow.md) for the complete agent workflow.
