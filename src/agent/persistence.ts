import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { AgentApplicationOptions } from '@miao/agent';
import type { HarnessStore } from '@miao/agent/harness';
import type {
  AgentSessionStore,
  CreateMiaoRunInput,
  InputJournal,
  MiaoRunCompletion,
  MiaoRunFailure,
  MiaoRunListFilter,
  MiaoRunReport,
  MiaoRunReportStore,
} from '@miao/agent/testing';
import { loadMiao } from './miao';

type Persistence = AgentApplicationOptions['persistence'];
type HarnessRecord = Parameters<Persistence['harness']['put']>[0];
type HarnessKind = HarnessRecord['kind'];
type HarnessFilter = Exclude<Parameters<Persistence['harness']['list']>[1], undefined>;
type RequestStore = Persistence['requests'];
type RequestRecord = Parameters<RequestStore['begin']>[0];
type ServiceResponse = Parameters<RequestStore['settle']>[1];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class SqliteRequestStore implements RequestStore {
  readonly durable = true;

  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS agent_service_requests (request_id TEXT PRIMARY KEY, record TEXT NOT NULL)'
    );
  }

  get(requestId: string): RequestRecord | null {
    const row = this.db
      .prepare('SELECT record FROM agent_service_requests WHERE request_id = ?')
      .get(requestId) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as RequestRecord) : null;
  }

  begin(record: RequestRecord): void {
    try {
      this.db
        .prepare('INSERT INTO agent_service_requests (request_id, record) VALUES (?, ?)')
        .run(record.requestId, JSON.stringify(record));
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
        throw new Error('SERVICE_REQUEST_EXISTS');
      throw error;
    }
  }

  settle(requestId: string, response: ServiceResponse): void {
    const record = this.get(requestId);
    if (!record) throw new Error('SERVICE_REQUEST_MISSING');
    this.db.prepare('UPDATE agent_service_requests SET record = ? WHERE request_id = ?').run(
      JSON.stringify({
        ...record,
        status: response.ok ? ('confirmed' as const) : ('failed' as const),
        revision: record.revision + 1,
        response,
      }),
      requestId
    );
  }
}

class SqliteHarnessStore implements HarnessStore {
  readonly durable = true;

  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS agent_harness_records (kind TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (kind, id))'
    );
  }

  get<K extends HarnessKind>(kind: K, id: string): Extract<HarnessRecord, { kind: K }> | null {
    const row = this.db
      .prepare('SELECT record FROM agent_harness_records WHERE kind = ? AND id = ?')
      .get(kind, id) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as Extract<HarnessRecord, { kind: K }>) : null;
  }

  list<K extends HarnessKind>(
    kind: K,
    filter: HarnessFilter = {}
  ): Extract<HarnessRecord, { kind: K }>[] {
    const rows = this.db
      .prepare('SELECT record FROM agent_harness_records WHERE kind = ?')
      .all(kind) as { record: string }[];
    return rows
      .map((row) => JSON.parse(row.record) as Extract<HarnessRecord, { kind: K }>)
      .filter((record) => matches(record, filter))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 500));
  }

  put(record: HarnessRecord, expectedRevision?: number | null): void {
    const existing = this.get(record.kind, record.id);
    if (record.kind === 'journal' && existing) {
      if (JSON.stringify(existing) === JSON.stringify(record)) return;
      throw new Error('Harness record changed or already exists.');
    }
    if (expectedRevision === null) {
      if (existing) throw new Error('Harness record changed or already exists.');
    } else if (typeof expectedRevision === 'number') {
      if (!existing || existing.revision !== expectedRevision)
        throw new Error('Harness record changed or already exists.');
    }
    this.db
      .prepare(
        'INSERT INTO agent_harness_records (kind, id, record) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET record = excluded.record'
      )
      .run(record.kind, record.id, JSON.stringify(record));
  }

  remove(kind: HarnessKind, id: string): void {
    if (kind === 'journal' && this.get(kind, id))
      throw new Error('Harness record changed or already exists.');
    this.db.prepare('DELETE FROM agent_harness_records WHERE kind = ? AND id = ?').run(kind, id);
  }

  purge(scope: { sessionIds: readonly string[]; taskIds: readonly string[] }): void {
    const sessions = new Set(scope.sessionIds);
    const tasks = new Set(scope.taskIds);
    const rows = this.db.prepare('SELECT record FROM agent_harness_records').all() as {
      record: string;
    }[];
    const remove = this.db.prepare('DELETE FROM agent_harness_records WHERE kind = ? AND id = ?');
    for (const row of rows) {
      const record = JSON.parse(row.record) as HarnessRecord;
      const taskId =
        'taskId' in record && typeof record.taskId === 'string'
          ? record.taskId
          : record.kind === 'task'
            ? record.id
            : null;
      if (sessions.has(record.sessionId) || (taskId !== null && tasks.has(taskId)))
        remove.run(record.kind, record.id);
    }
  }

  transaction<T>(run: () => T): T {
    return this.db.transaction(run)();
  }
}

function matches(record: HarnessRecord, filter: HarnessFilter): boolean {
  if (filter.workspaceId !== undefined && record.workspaceId !== filter.workspaceId) return false;
  if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false;
  if (filter.sessionId !== undefined && record.sessionId !== filter.sessionId) return false;
  if (filter.taskId !== undefined && (!('taskId' in record) || record.taskId !== filter.taskId))
    return false;
  if (
    filter.parentTaskId !== undefined &&
    (!('parentTaskId' in record) || record.parentTaskId !== filter.parentTaskId)
  )
    return false;
  if (filter.status !== undefined && (!('status' in record) || record.status !== filter.status))
    return false;
  if (
    filter.journalTypes?.length &&
    (record.kind !== 'journal' || !filter.journalTypes.includes(record.type))
  )
    return false;
  if (filter.versionUseKey) {
    if (record.kind !== 'journal' || record.type !== 'version-use') return false;
    const data = record.data as {
      use?: {
        domain?: string;
        targetId?: string;
        version?: { versionId?: string; contentHash?: string };
      };
    };
    const key = filter.versionUseKey;
    if (
      data.use?.domain !== key.domain ||
      data.use.targetId !== key.targetId ||
      data.use.version?.versionId !== key.version.versionId ||
      data.use.version?.contentHash !== key.version.contentHash
    )
      return false;
  }
  return true;
}

/**
 * Phase 1: transcript/projection storage is still MiaoTs' in-memory store, but
 * the input journal is durable so `input.send` receives a real receipt. This is
 * the smallest adapter that avoids claiming durable transcripts we do not have.
 */
class JournalSessionStore implements AgentSessionStore {
  readonly durableTranscripts = false;
  readonly durableInputJournal = true;

  constructor(
    private readonly inner: AgentSessionStore,
    private readonly db: Database.Database
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS agent_input_journals (session_id TEXT PRIMARY KEY, record TEXT NOT NULL)'
    );
  }

  saveInlineResult(...args: Parameters<AgentSessionStore['saveInlineResult']>) {
    return this.inner.saveInlineResult(...args);
  }

  listInlineResults(...args: Parameters<AgentSessionStore['listInlineResults']>) {
    return this.inner.listInlineResults(...args);
  }

  saveInputJournal(sessionId: string, journal: InputJournal): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO agent_input_journals (session_id, record) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET record = excluded.record'
      )
      .run(sessionId, JSON.stringify(journal));
    return Promise.resolve();
  }

  loadInputJournal(sessionId: string): Promise<InputJournal | undefined> {
    const row = this.db
      .prepare('SELECT record FROM agent_input_journals WHERE session_id = ?')
      .get(sessionId) as { record: string } | undefined;
    return Promise.resolve(row ? (JSON.parse(row.record) as InputJournal) : undefined);
  }

  load(...args: Parameters<AgentSessionStore['load']>) {
    return this.inner.load(...args);
  }

  save(...args: Parameters<AgentSessionStore['save']>) {
    return this.inner.save(...args);
  }

  renameSession(...args: Parameters<AgentSessionStore['renameSession']>) {
    return this.inner.renameSession(...args);
  }

  delete(...args: Parameters<AgentSessionStore['delete']>) {
    return this.inner.delete(...args);
  }

  list(...args: Parameters<AgentSessionStore['list']>) {
    return this.inner.list(...args);
  }

  listByAgent(...args: Parameters<AgentSessionStore['listByAgent']>) {
    return this.inner.listByAgent(...args);
  }

  deleteByAgentSync(agentId: string): string[] {
    const ids = this.inner.deleteByAgentSync?.(agentId) ?? [];
    const remove = this.db.prepare('DELETE FROM agent_input_journals WHERE session_id = ?');
    for (const id of ids) remove.run(id);
    return ids;
  }

  saveTranscript(...args: Parameters<AgentSessionStore['saveTranscript']>) {
    return this.inner.saveTranscript(...args);
  }

  loadTranscript(...args: Parameters<AgentSessionStore['loadTranscript']>) {
    return this.inner.loadTranscript(...args);
  }

  revision(...args: Parameters<NonNullable<AgentSessionStore['revision']>>) {
    if (!this.inner.revision) return Promise.resolve(0);
    return this.inner.revision(...args);
  }

  listTranscripts(...args: Parameters<AgentSessionStore['listTranscripts']>) {
    return this.inner.listTranscripts(...args);
  }
}

function progress(status: MiaoRunReport['status']): MiaoRunReport['progress'] {
  if (status === 'queued') return { stage: 'queued' };
  if (status === 'running') return { stage: 'running' };
  if (status === 'waiting_for_user') return { stage: 'waiting_for_user' };
  return undefined;
}

/** Ephemeral report rows; reports are not part of the first prompt path. */
class MemoryReports implements MiaoRunReportStore {
  private readonly rows = new Map<string, MiaoRunReport>();

  create(input: CreateMiaoRunInput): MiaoRunReport {
    const now = Date.now();
    const row: MiaoRunReport = {
      runId: randomUUID(),
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      requestedByAgentId: input.requestedByAgentId,
      sessionId: input.sessionId,
      task: input.task,
      status: 'queued',
      progress: progress('queued'),
      createdAt: now,
      updatedAt: now,
      evidenceRefs: [],
      needsReview: false,
    };
    this.rows.set(row.runId, row);
    return clone(row);
  }

  get(runId: string): MiaoRunReport | undefined {
    const row = this.rows.get(runId);
    return row ? clone(row) : undefined;
  }

  list(filter: MiaoRunListFilter = {}): MiaoRunReport[] {
    const statuses =
      filter.status === undefined
        ? null
        : new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
    return [...this.rows.values()]
      .filter(
        (row) =>
          (filter.workspaceId === undefined || row.workspaceId === filter.workspaceId) &&
          (filter.agentId === undefined || row.agentId === filter.agentId) &&
          (statuses === null || statuses.has(row.status))
      )
      .sort((a, b) => b.createdAt - a.createdAt || b.runId.localeCompare(a.runId))
      .slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100))
      .map(clone);
  }

  setProgress(runId: string, value?: MiaoRunReport['progress']): MiaoRunReport | undefined {
    const row = this.rows.get(runId);
    if (!row || row.status !== 'running') return row ? clone(row) : undefined;
    return this.transition(runId, ['running'], { progress: value ?? progress(row.status) });
  }

  start(runId: string): MiaoRunReport | undefined {
    return this.transition(runId, ['queued'], { status: 'running', startedAt: Date.now() });
  }

  waitForUser(runId: string): MiaoRunReport | undefined {
    return this.transition(runId, ['queued', 'running'], { status: 'waiting_for_user' });
  }

  resume(runId: string): MiaoRunReport | undefined {
    return this.transition(runId, ['waiting_for_user'], { status: 'running' });
  }

  complete(runId: string, completion: MiaoRunCompletion): MiaoRunReport | undefined {
    return this.transition(runId, ['queued', 'running', 'waiting_for_user'], {
      status: 'succeeded',
      completedAt: Date.now(),
      summary: completion.summary,
      detailedReport: completion.detailedReport,
      reportContent: completion.reportContent,
      evidenceRefs: completion.evidenceRefs ?? [],
      needsReview: false,
    });
  }

  fail(runId: string, failure: MiaoRunFailure): MiaoRunReport | undefined {
    return this.transition(runId, ['queued', 'running', 'waiting_for_user'], {
      status: 'failed',
      completedAt: Date.now(),
      summary: failure.summary,
      detailedReport: failure.detailedReport,
      reportContent: failure.reportContent,
      evidenceRefs: failure.evidenceRefs ?? [],
      needsReview: failure.needsReview ?? false,
      failureCode: failure.failureCode,
      failureMessage: failure.failureMessage,
    });
  }

  cancel(runId: string): MiaoRunReport | undefined {
    return this.transition(runId, ['queued', 'running', 'waiting_for_user'], {
      status: 'cancelled',
      completedAt: Date.now(),
      summary: 'Run cancelled',
      detailedReport: 'Run cancelled before completion could be confirmed.',
      needsReview: true,
      failureCode: 'cancelled',
    });
  }

  purgeSessions(sessionIds: readonly string[]): void {
    const doomed = new Set(sessionIds);
    for (const [id, row] of this.rows) {
      if (row.sessionId && doomed.has(row.sessionId)) this.rows.delete(id);
    }
  }

  private transition(
    runId: string,
    from: readonly MiaoRunReport['status'][],
    patch: Partial<MiaoRunReport>
  ): MiaoRunReport | undefined {
    const current = this.rows.get(runId);
    if (!current || !from.includes(current.status)) return current ? clone(current) : undefined;
    const next: MiaoRunReport = {
      ...current,
      ...patch,
      progress: progress(patch.status ?? current.status),
      updatedAt: Date.now(),
    };
    this.rows.set(runId, next);
    return clone(next);
  }
}

export interface LocalAgentPersistence {
  persistence: Persistence;
  close(): void;
}

/**
 * Phase 1 local persistence. Receipts, harness records and the input journal
 * are durable; transcripts/identities remain in memory until PMEM owns the
 * full session store.
 */
export async function createLocalAgentPersistence(
  databasePath: string
): Promise<LocalAgentPersistence> {
  if (!databasePath || databasePath === ':memory:')
    throw new Error('A durable Agent database path is required.');
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  const { testing } = await loadMiao();
  const sessions = new testing.MemoryAgentSessionStore();
  return {
    persistence: {
      identities: new testing.MemoryAgentRegistry(sessions),
      requests: new SqliteRequestStore(db),
      sessions: new JournalSessionStore(sessions, db),
      reports: new MemoryReports(),
      harness: new SqliteHarnessStore(db),
    },
    close: () => db.close(),
  };
}
