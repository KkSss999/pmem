# Creating and Managing Memory Cards

Memory cards are Markdown files with YAML frontmatter. They live under `.pmem/` and are the source of truth for project memory. Never edit `.pmem/pmem.db` directly.

## Card Types

| Type | Directory | Purpose |
|------|-----------|---------|
| `module` | `.pmem/modules/` | Code module description and ownership |
| `decision` | `.pmem/decisions/` | Architecture decisions and tradeoffs |
| `task` | `.pmem/tasks/` | Active and completed tasks |
| `feature` | `.pmem/features/` | Feature specifications |
| `risk` | `.pmem/risks/` | Identified risks and mitigations |
| `trace` | `.pmem/traces/` | Work session traces |

## Module Card (most important)

```yaml
---
id: module.auth
type: module
status: active
tags: [auth, security]
aliases: [authentication, login]
source_files: [src/auth/index.ts, src/auth/login.ts]
depends_on: [decision.jwt_tokens]
---
# Auth Module

## Purpose
Handles user authentication and token management.

## Key Behavior
- Validates credentials
- Issues JWT tokens
- Refreshes expired tokens
```

The `source_files` field is critical — it links code files to memory. When `src/auth/index.ts` changes, pmem knows to flag `module.auth` as potentially stale.

## Decision Card

```yaml
---
id: decision.jwt_tokens
type: decision
status: accepted
tags: [auth, architecture]
---
# Use JWT for Authentication

## Context
Needed stateless authentication for horizontal scaling.

## Decision
Use JWT with RS256 signing.

## Consequences
- No server-side session store needed
- Token revocation requires blocklist
```

## Task Card

```yaml
---
id: task.add_2fa
type: task
status: in_progress
priority: high
tags: [auth, security]
depends_on: [module.auth]
---
# Add Two-Factor Authentication

## Goal
Add TOTP-based 2FA to the auth flow.
```

## After Creating or Editing Cards

```bash
pmem rebuild
```

This re-parses all `.md` cards and updates the SQLite index.
