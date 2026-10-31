import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const migrations = sqliteTable('pmem_migrations', {
  id: integer('id').primaryKey(),
  hash: text('hash').notNull(),
  appliedAt: text('applied_at').notNull(),
});
