import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { migrations } from './schema';

const migrationTable = (name: string) =>
  sqliteTable(name, {
    id: integer('id').primaryKey(),
    hash: text('hash').notNull(),
    appliedAt: text('applied_at').notNull(),
  });

const root = resolve(__dirname, '../../migrations');

// Each journal and ledger is owned independently; foundation retains its original ledger.
export const migrationOwners = [
  { name: 'foundation', folder: root, table: migrations, required: true },
  {
    name: 'memory',
    folder: resolve(root, 'memory'),
    table: migrationTable('pmem_memory_migrations'),
    required: false,
  },
  {
    name: 'knowledge',
    folder: resolve(root, 'knowledge'),
    table: migrationTable('pmem_knowledge_migrations'),
    required: false,
  },
] as const;

export interface MigrationSet {
  owner: (typeof migrationOwners)[number];
  files: MigrationMeta[];
}

export function readMigrations(): MigrationSet[] {
  return migrationOwners.map((owner) => {
    const files =
      !owner.required && !existsSync(owner.folder)
        ? []
        : readMigrationFiles({ migrationsFolder: owner.folder });
    if (
      (owner.required && !files.length) ||
      files.some((file, index) => index > 0 && file.folderMillis <= files[index - 1].folderMillis)
    ) {
      throw new Error(`Invalid migration order for ${owner.name}.`);
    }
    return { owner, files };
  });
}
