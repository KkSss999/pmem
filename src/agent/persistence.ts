import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { AgentApplicationOptions } from '@miao/agent';
import type { HarnessStore } from '@miao/agent/harness';
import type { SqliteAgentSessionStore } from '@miao/agent/testing';
import { loadMiao } from './miao';

type Persistence = AgentApplicationOptions['persistence'];
type HarnessRecord = Parameters<Persistence['harness']['put']>[0];
type HarnessKind = HarnessRecord['kind'];
type HarnessFilter = Exclude<Parameters<Persistence['harness']['list']>[1], undefined>;
type RequestStore = Persistence['requests'];
type RequestRecord = Parameters<RequestStore['begin']>[0];
type ServiceResponse = Parameters<RequestStore['settle']>[1];
type MiaoSqliteDatabase = ConstructorParameters<typeof SqliteAgentSessionStore>[0];

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

export interface LocalAgentPersistence {
  persistence: Persistence;
  close(): void;
}

function loadOrCreateKey(path: string): Uint8Array {
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error('The Agent storage key must be 32 bytes.');
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return key;
}

/**
 * The MiaoTs store asks the database driver whether it is file-backed before
 * running its own migration. PMEM already made the pre-migration copy, so the
 * adapter reports an in-memory handle to avoid a second, unbound backup port.
 */
function sqliteAdapter(db: Database.Database): MiaoSqliteDatabase {
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      if (sql.trim() === 'PRAGMA database_list')
        return {
          run: () => ({ changes: 0 }),
          get: () => undefined,
          all: () => [{ file: '' }],
        } as never;
      return db.prepare(sql) as never;
    },
    close: () => db.close(),
  };
}

/**
 * Local Agent persistence: receipts, harness records, sessions, identities,
 * reports and encrypted transcripts live in one file. PMEM makes a pre-migration
 * copy before MiaoTs opens its schemas.
 */
export async function createLocalAgentPersistence(
  databasePath: string
): Promise<LocalAgentPersistence> {
  if (!databasePath || databasePath === ':memory:')
    throw new Error('A durable Agent database path is required.');
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(TRUNCATE)');
  const backup = `${databasePath}.backup`;
  if (!existsSync(backup)) {
    copyFileSync(databasePath, backup);
    chmodSync(backup, 0o600);
  }
  const key = loadOrCreateKey(`${databasePath}.key`);
  const sqlite = sqliteAdapter(db);
  const { testing } = await loadMiao();
  return {
    persistence: {
      identities: new testing.AgentRegistry(sqlite),
      requests: new SqliteRequestStore(db),
      sessions: new testing.SqliteAgentSessionStore(sqlite, key),
      reports: new testing.SqliteRunReportStore(sqlite, { storageKey: key }),
      harness: new SqliteHarnessStore(db),
    },
    close: () => db.close(),
  };
}
