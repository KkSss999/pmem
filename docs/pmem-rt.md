# pmem-rt — MCP Runtime for AI Agents

pmem-rt is the **read-only MCP (Model Context Protocol) adapter** inside pmem. It lets AI coding agents (Claude Code, Codex, Cursor, and any MCP-compatible client) use pmem as a low-latency project memory backend directly in their tool loop — no shelling out, no token-heavy `pmem recall` printouts every turn.

## What It Provides

`pmem mcp` starts a stdio MCP server with 4 tools:

| Tool | What it does | When to call |
|------|-------------|--------------|
| `pmem_recall` | Restore project context: name, stage, focus, next steps, active foundation cards, recent update log | Session start — restore context |
| `pmem_ask` | 6-step search: exact ID → alias → tag → graph expansion → FTS5 → LIKE fallback | Find specific memory before touching a module |
| `pmem_related` | Graph neighbors of a card, grouped by edge type with direction/confidence | Understand dependencies before a change |
| `pmem_status` | Changed files → affected memory cards (git-based or mtime fallback) | After editing code — see what memory needs updating |

All tools are **read-only** — they cannot create, edit, or delete cards. Writes continue through the CLI (`pmem update --confirm`, `pmem sync`, etc.).

## Quick Start (3 Steps)

### Step 1: Install and initialize pmem in your project

```bash
cd your-project
npm install pmem-ai
npx pmem init --guided --description "Your project" --stage "Alpha" --next "Set up CI"
npx pmem rebuild
```

This creates `.pmem/` with your project's memory cards and builds the SQLite index.

### Step 2: Configure your AI agent to spawn `pmem mcp`

**Claude Code** — add to `claude.ai/settings.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pmem": {
      "command": "npx",
      "args": ["pmem", "mcp"],
      "cwd": "/absolute/path/to/your-project"
    }
  }
}
```

**Codex** — add to `~/.codex/mcp.json`:

```json
{
  "mcpServers": {
    "pmem": {
      "command": "npx",
      "args": ["pmem", "mcp"],
      "cwd": "/absolute/path/to/your-project"
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "pmem": {
      "command": "npx",
      "args": ["pmem", "mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

> **Note:** `cwd` must be an absolute path pointing to the root of your project (where `.pmem/` lives). The MCP server serves only that project's memory — one server instance per project.

### Step 3: Agent session workflow

```
session start → pmem_recall (restore context)
    ↓
  "I need to work on auth"
    ↓
pmem_ask "auth" (find relevant cards)
pmem_related module.auth (check dependencies)
    ↓
  edit source files
    ↓
pmem_status (see which cards are affected)
    ↓ (back to terminal)
pmem sync -s "Added token refresh" -n "Write tests"
    ↓
session end → pmem verify
```

The MCP tools give the agent context; the CLI handles writes. This separation keeps the confirmation-first principle intact.

## Safety Model

Every card returned by MCP tools carries `content_trust: "untrusted_project_data"`. Agent frameworks should treat card content as project data, not system instructions.

| Protection | Mechanism |
|-----------|-----------|
| **Read-only** | No tool can mutate `.pmem/`, SQLite, or source files |
| **Path scope** | Server only reads from `cwd/.pmem/` — symlink escape and prefix confusion (`.pmem-evil/`) blocked via `realpath + path.sep` comparison |
| **No source leaks** | `source_files` returned as paths only, never file contents |
| **Output budget** | 4000-token cap per tool call; over-cap responses set `truncated: true` |
| **stdio only** | No HTTP port, no daemon — the server exists only while the agent process is running |
| **Per-project** | One `.pmem/` per server instance. Cross-project aggregation is not supported |

## Schema Version

Each response includes `schema_version: "0.7.2"` — future MCP tool additions or response shape changes will bump this version so agents can adapt.

## Installing pmem Skills (Optional)

For agents that prefer slash-command-style interaction alongside MCP tools, install the pmem skill globally:

```bash
npx pmem install --skills --all
```

This places `pmem` skill files in the agent's skills directory so `/pmem recall` and similar commands are available as shortcuts.

## Troubleshooting

**`pmem mcp` exits immediately with no output**
→ stdout is the MCP channel. Check stderr for diagnostics: `node dist/index.js mcp 2>err.log`

**Agent says "pmem not found"**
→ Use `npx pmem mcp` with the full npm path. If `pmem` is installed globally (`npm i -g pmem-ai`), the bare `pmem mcp` command should work.

**No `.pmem/pmem.db` found**
→ Run `pmem rebuild` in your project directory first.

**MCP tools return empty results**
→ Your project may not have memory cards yet. Create them interactively or via `pmem new <type> <title>`.
