import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const memoryStreamQueue = sqliteTable(
  'memory_stream_queue',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    scopeId: text('scope_id').notNull(),
    kind: text('kind').notNull(),
    subjectId: text('subject_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    state: text('state').notNull(),
    attempt: integer('attempt').notNull().default(0),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => ({
    item: uniqueIndex('memory_stream_queue_item').on(
      table.workspaceId,
      table.scopeId,
      table.kind,
      table.subjectId,
      table.sourceHash
    ),
    state: index('memory_stream_queue_state').on(
      table.workspaceId,
      table.scopeId,
      table.state,
      table.createdAt
    ),
  })
);

export const memoryStreamSessions = sqliteTable(
  'memory_stream_sessions',
  {
    workspaceId: text('workspace_id').notNull(),
    scopeId: text('scope_id').notNull(),
    agentId: text('agent_id').notNull(),
    sessionId: text('session_id').notNull(),
    contextTokens: integer('context_tokens').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: uniqueIndex('memory_stream_sessions_pk').on(table.workspaceId, table.scopeId),
  })
);
