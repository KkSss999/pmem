import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const spaces = sqliteTable(
  'memory_spaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('memory_space_kind_check', sql`${table.kind} IN ('personal', 'custom')`),
    uniqueIndex('memory_one_personal_space')
      .on(table.kind)
      .where(sql`${table.kind} = 'personal'`),
  ]
);

export const l0Messages = sqliteTable(
  'memory_l0_messages',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    role: text('role').notNull(),
    content: text('content').notNull(),
    source: text('source'),
    sourceEventId: text('source_event_id'),
    sessionId: text('session_id'),
    occurredAt: text('occurred_at'),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [
    uniqueIndex('memory_l0_id').on(table.id),
    uniqueIndex('memory_l0_source_event').on(table.spaceId, table.source, table.sourceEventId),
    index('memory_l0_space_sequence').on(table.spaceId, table.sequence),
    index('memory_l0_session_sequence').on(table.spaceId, table.sessionId, table.sequence),
    index('memory_l0_auto_group').on(table.spaceId, table.source, table.sessionId, table.sequence),
    check('memory_l0_role_check', sql`${table.role} IN ('user', 'assistant')`),
    check(
      'memory_l0_source_check',
      sql`${table.sourceEventId} IS NULL OR ${table.source} IS NOT NULL`
    ),
  ]
);

export const l1Memories = sqliteTable(
  'memory_l1',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => l1Jobs.id),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    content: text('content').notNull(),
    abstraction: text('abstraction').notNull(),
    maintenanceStatus: text('maintenance_status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('memory_l1_space').on(table.spaceId),
    check(
      'memory_l1_maintenance_check',
      sql`${table.maintenanceStatus} IN ('pending', 'complete', 'failed')`
    ),
  ]
);

export const l1Sources = sqliteTable(
  'memory_l1_sources',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => l1Memories.id),
    l0Id: text('l0_id')
      .notNull()
      .references(() => l0Messages.id),
  },
  (table) => [
    uniqueIndex('memory_l1_source_unique').on(table.memoryId, table.l0Id),
    index('memory_l1_source_reverse').on(table.l0Id, table.memoryId),
  ]
);

export const l1SpaceLinks = sqliteTable(
  'memory_l1_space_links',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => l1Memories.id),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
  },
  (table) => [
    uniqueIndex('memory_l1_space_link_unique').on(table.memoryId, table.spaceId),
    index('memory_l1_space_link_reverse').on(table.spaceId, table.memoryId),
  ]
);

export const l1Cues = sqliteTable(
  'memory_l1_cues',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => l1Memories.id),
    cue: text('cue').notNull(),
  },
  (table) => [uniqueIndex('memory_l1_cue_unique').on(table.memoryId, table.cue)]
);

export const l1Jobs = sqliteTable(
  'memory_l1_jobs',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    state: text('state').notNull(),
    claimToken: text('claim_token'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    failureCode: text('failure_code'),
  },
  (table) => [
    index('memory_l1_job_state').on(table.spaceId, table.state),
    check(
      'memory_l1_job_state_check',
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'failed', 'unknown')`
    ),
  ]
);

export const l1JobResults = sqliteTable(
  'memory_l1_job_results',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => l1Jobs.id),
    memoryId: text('memory_id')
      .notNull()
      .references(() => l1Memories.id),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.memoryId] }),
    index('memory_l1_job_result_reverse').on(table.memoryId),
  ]
);

export const l1MaintenanceTasks = sqliteTable(
  'memory_l1_maintenance_tasks',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    memoryId: text('memory_id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    state: text('state').notNull(),
    claimToken: text('claim_token'),
    failureCode: text('failure_code'),
    outcome: text('outcome'),
    resultMemoryId: text('result_memory_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('memory_l1_maintenance_memory').on(table.memoryId),
    index('memory_l1_maintenance_state').on(table.state, table.sequence),
    check(
      'memory_l1_maintenance_state_check',
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'failed', 'unknown')`
    ),
  ]
);

export const l1JobSources = sqliteTable(
  'memory_l1_job_sources',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => l1Jobs.id),
    l0Id: text('l0_id')
      .notNull()
      .references(() => l0Messages.id),
  },
  (table) => [
    uniqueIndex('memory_l1_job_source_unique').on(table.jobId, table.l0Id),
    index('memory_l1_job_source_reverse').on(table.l0Id),
  ]
);

export const l1AutoGroups = sqliteTable(
  'memory_l1_auto_groups',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
    source: text('source').notNull(),
    sessionId: text('session_id').notNull(),
    lastActivity: text('last_activity').notNull(),
    cursor: integer('cursor').notNull().default(0),
    activeJobId: text('active_job_id').references(() => l1Jobs.id),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.source, table.sessionId] })]
);

export const l1JobSpaces = sqliteTable(
  'memory_l1_job_spaces',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => l1Jobs.id),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
  },
  (table) => [uniqueIndex('memory_l1_job_space_unique').on(table.jobId, table.spaceId)]
);

export const l2Memories = sqliteTable(
  'memory_l2',
  {
    id: text('id').primaryKey(),
    ownerSpaceId: text('owner_space_id')
      .notNull()
      .references(() => spaces.id),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    body: text('body').notNull(),
    contentHash: text('content_hash').notNull(),
    needsUpdate: integer('needs_update').notNull().default(0),
    visible: integer('visible').notNull().default(1),
    generationId: text('generation_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('memory_l2_owner_updated').on(table.ownerSpaceId, table.updatedAt),
    index('memory_l2_needs_update').on(table.needsUpdate),
    index('memory_l2_visible').on(table.visible),
    check(
      'memory_l2_flags_check',
      sql`${table.needsUpdate} IN (0, 1) AND ${table.visible} IN (0, 1)`
    ),
  ]
);

export const l2SpaceLinks = sqliteTable(
  'memory_l2_space_links',
  {
    l2Id: text('l2_id')
      .notNull()
      .references(() => l2Memories.id),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id),
  },
  (table) => [
    uniqueIndex('memory_l2_space_link_unique').on(table.l2Id, table.spaceId),
    index('memory_l2_space_link_reverse').on(table.spaceId, table.l2Id),
  ]
);

export const l2L1Links = sqliteTable(
  'memory_l2_l1_links',
  {
    l2Id: text('l2_id')
      .notNull()
      .references(() => l2Memories.id),
    l1Id: text('l1_id').notNull(),
  },
  (table) => [
    uniqueIndex('memory_l2_l1_link_unique').on(table.l2Id, table.l1Id),
    index('memory_l2_l1_link_reverse').on(table.l1Id, table.l2Id),
  ]
);

export const l2L0Sources = sqliteTable(
  'memory_l2_l0_sources',
  {
    l2Id: text('l2_id')
      .notNull()
      .references(() => l2Memories.id),
    l0Id: text('l0_id')
      .notNull()
      .references(() => l0Messages.id),
    generationId: text('generation_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.l2Id, table.l0Id, table.generationId] }),
    index('memory_l2_l0_source_reverse').on(table.l0Id),
  ]
);

export const l2Jobs = sqliteTable(
  'memory_l2_jobs',
  {
    id: text('id').primaryKey(),
    ownerSpaceId: text('owner_space_id')
      .notNull()
      .references(() => spaces.id),
    state: text('state').notNull(),
    claimToken: text('claim_token'),
    promptVersion: text('prompt_version'),
    failureCode: text('failure_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('memory_l2_job_state').on(table.ownerSpaceId, table.state),
    check(
      'memory_l2_job_state_check',
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'unknown')`
    ),
  ]
);

export const l2JobResults = sqliteTable(
  'memory_l2_job_results',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => l2Jobs.id),
    resultIndex: integer('result_index').notNull(),
    state: text('state').notNull(),
    action: text('action').notNull(),
    l2Id: text('l2_id').references(() => l2Memories.id),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('memory_l2_job_result_index').on(table.jobId, table.resultIndex),
    index('memory_l2_job_result_l2').on(table.l2Id),
    check(
      'memory_l2_job_result_state_check',
      sql`${table.state} IN ('committed', 'failed', 'skipped')`
    ),
    check('memory_l2_job_result_action_check', sql`${table.action} IN ('create', 'update')`),
  ]
);

export const l2Changes = sqliteTable(
  'memory_l2_changes',
  {
    id: text('id').primaryKey(),
    l1Id: text('l1_id').notNull(),
    ownerSpaceId: text('owner_space_id')
      .notNull()
      .references(() => spaces.id),
    kind: text('kind').notNull(),
    l1Hash: text('l1_hash').notNull(),
    survivorL1Id: text('survivor_l1_id'),
    state: text('state').notNull(),
    jobId: text('job_id').references(() => l2Jobs.id),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
    processedAt: text('processed_at'),
  },
  (table) => [
    index('memory_l2_change_pending').on(table.ownerSpaceId, table.state, table.createdAt),
    index('memory_l2_change_l1').on(table.l1Id),
    check(
      'memory_l2_change_kind_check',
      sql`${table.kind} IN ('created', 'content_changed', 'scope_changed', 'merged', 'removed')`
    ),
    check(
      'memory_l2_change_state_check',
      sql`${table.state} IN ('pending', 'claimed', 'processed', 'uncovered', 'failed')`
    ),
  ]
);
