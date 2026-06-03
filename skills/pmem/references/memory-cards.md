# Creating and Managing Memory Cards

Memory cards are Markdown files with YAML frontmatter. They live under `.pmem/` and are the source of truth for project memory. Never edit `.pmem/pmem.db` directly.

## Card Types

The default `software` preset uses these common card types:

| Type | Directory | Purpose |
|------|-----------|---------|
| `module` | `.pmem/modules/` | Code module description and ownership |
| `decision` | `.pmem/decisions/` | Architecture decisions and tradeoffs |
| `task` | `.pmem/tasks/` | Active and completed tasks |
| `feature` | `.pmem/features/` | Feature specifications |
| `risk` | `.pmem/risks/` | Identified risks and mitigations |
| `trace` | `.pmem/traces/` | Work session traces |

v0.7.0 supports domain presets and custom schemas. A `novel` project can use `character`, `chapter`, `world`, and `arc`; a `research` project can use `source`, `claim`, `note`, and `experiment`. Check `.pmem/manifest.yml` → `schema.card_types`, `schema.type_dirs`, and `schema.creatable_types` for the project's valid types.

## Software Module Card

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

## Novel Character Card

```yaml
---
id: character.protagonist
type: character
status: active
tags: [main-cast]
aliases: [hero]
source_files: [draft/characters/protagonist.md]
---
# Protagonist

## Role
Primary viewpoint character.

## Motivation
Wants to recover a lost family archive.
```

## Research Source Card

```yaml
---
id: source.smith_2024_survey
type: source
status: active
tags: [memory, agents]
source_files: [papers/smith-2024.pdf]
---
# Smith 2024 Survey

## Summary
Survey of persistent memory approaches for AI agents.

## Evidence
Supports claims about cross-session continuity.
```

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

## Cross-Referencing Cards in Body Text

Use `[[card-id]]` wikilinks in card body markdown to create relationships. This is the primary way to declare inter-card links in non-software domains (novel, research) where `pmem discover` is disabled, and it also works in software projects.

```markdown
## Key Characters

- Protagonist: [[character.protagonist]]
- Mentor: [[character.mentor]]
- First appears in: [[chapter.intro]]
- Core motivation revealed in: [[arc.main_quest]]
```

On `pmem rebuild`, these create `type='references'` edges with `source='mention'` and `confidence=1.0`. Only links to actual existing card IDs create edges — typos or references to non-existent cards are silently ignored.

For frontmatter-declared relationships, continue using `depends_on:` and `related_to:` in YAML frontmatter.

## After Creating or Editing Cards

```bash
pmem rebuild
```

This re-parses all `.md` cards and updates the SQLite index — including scanning card bodies for `[[card-id]]` wikilinks.
