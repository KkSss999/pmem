# AGENTS.md

PMEM is a local Memory & Knowledge system for individuals, covering personal life, work, software projects, creative writing, research, and other contexts. The architecture authority is `docs/architecture.md`, with database decisions in `docs/database.md`.

- Keep `domain → service → api & db & other → server` boundaries. Domain adapters own their data; Runtime assembles and owns resources.
- Do not read or use the retired `.pmem` project memory. Do not delete, reset, or migrate existing user data without an explicit migration design and authorization.
- Focus current development on the Memory core. The existing SDK exposes database lifecycle only; Memory SDK and host adaptation, CLI, and MCP are future work.
- Use Bun for package management, Oxfmt for formatting, and Oxlint for linting. The SDK targets Node.js 22 and 24.
- Run `bun run check` before committing. This repository does not use GitHub Actions.
- Do not commit, publish, push, or create a PR without explicit authorization.
