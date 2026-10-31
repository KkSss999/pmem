# PMEM

PMEM is a local Memory & Knowledge system for individuals to manage and use information across their lives and work. Personal describes who the system serves; its content can cover software projects, creative writing, research, daily life, and other contexts.

The current development version provides database infrastructure, an embedded SDK lifecycle, and internal L0 and L1 Memory services. L1 extraction has an explicit task interface and OpenAI and DeepSeek API adapters; automatic extraction scheduling, keyword recall, and similar-memory maintenance are implemented internally. L2, L3, Knowledge, Memory SDK, host integration, CLI, and MCP are not implemented yet.

## Requirements

- Node.js 22 through 26
- Bun 1.4.4 for development and package management

```sh
bun install --frozen-lockfile
bun run check   # build, lint, format check, and tests
```

## SDK

The SDK accepts an explicit database file path. The containing directory must already exist.

```ts
import { Pmem } from 'pmem-ai';

const runtime = Pmem.create({ databasePath: '/path/to/pmem.sqlite' });
console.log(runtime.status());
runtime.close();

const reader = Pmem.open({ databasePath: '/path/to/pmem.sqlite', readOnly: true });
reader.close();
```

`Pmem.create` requires a new path; `Pmem.open` requires an existing database. Opening does not migrate. `Pmem.migrate({ databasePath, backupPath })` applies pending migrations after making a consistent backup at a new path. If no migration is pending, it returns without creating a backup. A failed creation or backup can leave a file at the requested path for inspection. Database and driver errors are propagated to the caller.

To avoid SQLite sidecar writes, opening or migrating an existing WAL-mode database is rejected. Each runtime owns its connection. Close it when finished. `status()` after closing raises a `PmemError` with code `CLOSED`. CLI and MCP are planned future entry points.

See [architecture](docs/architecture.md) and [database decisions](docs/database.md) for the target boundaries and remaining design work.
