import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import {
  createFTS5,
  createSchema,
  ftsTableExists,
  openOwnedDatabase,
} from '../core/db';
import {
  BackendCapabilities,
  BackendOpenContext,
  BackendQuery,
  BackendTransaction,
  BackendTransactionOptions,
  MaybePromise,
  MemoryBackend,
  MemoryEvent,
  MemoryEventType,
  MemoryHistoryOptions,
  MemoryJsonObject,
  MemoryProvenance,
  MemoryQueryResult,
  MemoryRecord,
  MemoryRelation,
  MemorySchemaRegistry,
  MemorySearchDocument,
  MemorySearchRequest,
  MemorySearchResult,
  memoryScopeId,
} from '../runtime/model';

/** Kept as an exported alias so Runtime never imports better-sqlite3 directly. */
export type SqliteDatabase = Database.Database;

/** Optional semantic projection installed by the v1.2 compatibility adapter.
 * The default SQLite backend remains deterministic-only when absent. */
export interface SqliteSemanticSearchAdapter {
  search(text: string, limit: number): MemorySearchResult | Promise<MemorySearchResult>;
}

export const SQLITE_BACKEND_CAPABILITIES: BackendCapabilities = {
  transactions: { atomic: true, isolation: 'serializable' },
  query: { structured: true, fulltext: true, graph: true, semantic: false },
  relations: true,
  search_index: true,
  projections: false,
};

/** A permissive registry used by the compatibility path until VS-3 installs one. */
export const EMPTY_SCHEMA_REGISTRY: MemorySchemaRegistry = {
  resolve: async ref => ({ ref, fields: [] }),
  list: async () => [],
};

interface CardRow {
  id: string;
  type: string;
  title: string;
  status: string | null;
  file_path: string;
  summary: string | null;
  schema_version: string | null;
  created_at: string | null;
  updated_at: string | null;
  confidence: number | null;
  trust_label: string | null;
  sensitivity: string | null;
  is_deleted: number;
}

interface CanonicalRecordRow {
  id: string;
  schema_id: string;
  schema_version: string;
  data_json: string;
  scope_json: string;
  provenance_json: string;
  state: string | null;
  record_version: number | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

/** Storage codec boundary: SQLite rows never define the canonical model. */
export interface MemoryCodec<StorageObject = CanonicalRecordRow> {
  encode(record: MemoryRecord): StorageObject;
  decode(row: StorageObject): MemoryRecord;
}

export class SqliteMemoryCodec implements MemoryCodec {
  encode(record: MemoryRecord): CanonicalRecordRow {
    return {
      id: record.id,
      schema_id: record.schema.id,
      schema_version: record.schema.version,
      data_json: JSON.stringify(record.data),
      scope_json: JSON.stringify(record.scope),
      provenance_json: JSON.stringify(record.provenance),
      state: record.state ?? 'active',
      record_version: record.version ?? null,
      created_at: record.created_at,
      updated_at: record.updated_at,
      is_deleted: record.state === 'forgotten' ? 1 : 0,
    };
  }

  decode(row: CanonicalRecordRow): MemoryRecord {
    return {
      id: row.id,
      schema: { id: row.schema_id, version: row.schema_version },
      data: objectJson(row.data_json),
      scope: jsonValue(row.scope_json, 'workspace') as MemoryRecord['scope'],
      provenance: objectJson(row.provenance_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
      state: row.state ?? 'active',
      ...(row.record_version === null ? {} : { version: row.record_version }),
    };
  }
}

/** Explicit importer for the legacy cards projection; not used for new writes. */
export class LegacyCardCodec implements MemoryCodec<CardRow> {
  encode(_record: MemoryRecord): CardRow {
    throw new Error('LegacyCardCodec is import-only. Use SqliteMemoryCodec for canonical writes.');
  }
  decode(row: CardRow): MemoryRecord { return toRecord(row); }
}

/**
 * SQLite implementation of the v1.3 backend port.
 *
 * Existing pmem tables remain the compatibility storage format. Canonical
 * records/events are translated at this boundary and never leak SQLite rows
 * into Runtime contracts.
 */
export class SqliteMemoryBackend implements MemoryBackend {
  readonly id = 'sqlite';
  private db: SqliteDatabase | null = null;
  private semanticAdapter: SqliteSemanticSearchAdapter | null = null;
  private readonly codec: MemoryCodec = new SqliteMemoryCodec();
  private readonly legacyCardCodec = new LegacyCardCodec();

  constructor(private readonly pmemPath: string) {}

  get capabilities(): BackendCapabilities {
    if (!this.semanticAdapter) return SQLITE_BACKEND_CAPABILITIES;
    return {
      ...SQLITE_BACKEND_CAPABILITIES,
      query: { ...SQLITE_BACKEND_CAPABILITIES.query, semantic: true },
    };
  }

  /** Install an explicit semantic adapter without changing default behavior. */
  setSemanticAdapter(adapter: SqliteSemanticSearchAdapter | null): void {
    this.semanticAdapter = adapter;
  }

  get database(): SqliteDatabase | null {
    return this.db;
  }

  open(_context: BackendOpenContext): void {
    if (this.db) return;
    this.db = openOwnedDatabase(this.pmemPath);
    createSchema(this.db);
    createFTS5(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        schema_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        data_json TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        state TEXT,
        record_version INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_memory_records_schema ON memory_records(schema_id, schema_version, updated_at);
      CREATE TABLE IF NOT EXISTS memory_search (
        record_id TEXT PRIMARY KEY,
        text TEXT NOT NULL DEFAULT '',
        fields_json TEXT NOT NULL DEFAULT '{}',
        embedding_json TEXT
      );
    `);
  }

  close(): void {
    if (!this.db) return;
    try { this.db.close(); } finally { this.db = null; }
  }

  getRecord(id: string): MemoryRecord | null {
    const db = this.requireDb();
    const canonical = db.prepare(
      `SELECT id, schema_id, schema_version, data_json, scope_json, provenance_json,
              state, record_version, created_at, updated_at, is_deleted
         FROM memory_records WHERE id = ? LIMIT 1`
    ).get(id) as CanonicalRecordRow | undefined;
    if (canonical) return canonical.is_deleted === 0 ? this.codec.decode(canonical) : null;
    const row = db.prepare(
      `SELECT id, type, title, status, file_path, summary, schema_version,
              created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
         FROM cards WHERE id = ? LIMIT 1`
    ).get(id) as CardRow | undefined;
    return row && row.is_deleted === 0 ? this.legacyCardCodec.decode(row) : null;
  }

  query(query: BackendQuery): MemoryQueryResult {
    const db = this.requireDb();
    const canonical = queryCanonicalRecords(db, query, this.codec);
    // Canonical writes own their ID. Legacy cards fill only records not yet
    // migrated, which keeps v1.2 data readable without making it the schema.
    const seen = new Set(canonical.records.map(record => record.id));
    const params: unknown[] = [];
    const where: string[] = ['is_deleted = 0'];
    if (query.schema) {
      where.push('schema_version = ?');
      params.push(query.schema.version);
    }
    if (query.scope) {
      // Legacy cards have no scope column; project scope is their canonical
      // compatibility scope. Explicit scope filters therefore remain safe and
      // deterministic without altering the v1.2 table schema.
      const scopes = (Array.isArray(query.scope) ? query.scope : [query.scope]).map(memoryScopeId);
      if (!scopes.includes('project')) return { records: [], total: 0 };
    }
    if (query.relation?.from_id) {
      where.push('id IN (SELECT to_id FROM edges WHERE from_id = ?' + (query.relation.type ? ' AND type = ?' : '') + ')');
      params.push(query.relation.from_id);
      if (query.relation.type) params.push(query.relation.type);
    }
    if (query.relation?.to_id) {
      where.push('id IN (SELECT from_id FROM edges WHERE to_id = ?' + (query.relation.type ? ' AND type = ?' : '') + ')');
      params.push(query.relation.to_id);
      if (query.relation.type) params.push(query.relation.type);
    }
    for (const filter of query.filters ?? []) {
      if (!isSafeColumn(filter.field)) continue;
      const op = filter.operator ?? 'eq';
      if (op === 'in' && Array.isArray(filter.value)) {
        if (filter.value.length === 0) return { records: [], total: 0 };
        where.push(`${filter.field} IN (${filter.value.map(() => '?').join(', ')})`);
        params.push(...filter.value);
      } else if (op === 'contains') {
        where.push(`CAST(${filter.field} AS TEXT) LIKE ?`);
        params.push(`%${String(filter.value)}%`);
      } else {
        const sqlOp = ({ eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[op] ?? '=';
        where.push(`${filter.field} ${sqlOp} ?`);
        params.push(filter.value);
      }
    }
    const orderBy = (query.order_by ?? [])
      .filter(item => isSafeColumn(item.field))
      .map(item => `${item.field} ${(item.direction ?? 'asc').toUpperCase()}`);
    const order = orderBy.length > 0 ? orderBy.join(', ') : 'updated_at DESC, id ASC';
    const limit = normalizeLimit(query.limit);
    const sql = `SELECT id, type, title, status, file_path, summary, schema_version,
                        created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
                   FROM cards WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`;
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as CardRow[];
    const legacy = rows.map(row => this.legacyCardCodec.decode(row)).filter(record => !seen.has(record.id));
    return { records: [...canonical.records, ...legacy].slice(0, normalizeLimit(query.limit)), total: canonical.records.length + legacy.length };
  }

  search(request: MemorySearchRequest & { channel?: 'lexical' }): MemorySearchResult;
  search(request: MemorySearchRequest & { channel: 'semantic' }): Promise<MemorySearchResult>;
  search(request: MemorySearchRequest): MemorySearchResult | Promise<MemorySearchResult> {
    const db = this.requireDb();
    const text = request.text?.trim() ?? '';
    const limit = normalizeLimit(request.limit);
    if (request.channel === 'semantic') {
      if (!this.semanticAdapter) {
        return Promise.resolve({
          hits: [],
          warnings: ['semantic retriever unavailable: SQLite semantic adapter is not configured'],
        });
      }
      return this.semanticAdapter.search(text, limit);
    }
    const scopeClause = request.scope && !scopeIncludesProject((Array.isArray(request.scope) ? request.scope : [request.scope]).map(memoryScopeId))
      ? ' AND 1 = 0'
      : '';
    if (!text) {
      const rows = db.prepare(
        `SELECT id AS record_id, 0.0 AS score FROM cards
          WHERE is_deleted = 0${scopeClause} ORDER BY updated_at DESC, id ASC LIMIT ?`
      ).all(limit) as Array<{ record_id: string; score: number }>;
      return { hits: rows };
    }

    // Canonical records may provide their own search projection even when no
    // legacy card/FTS row exists. Search that projection first, then merge any
    // legacy card matches below without returning duplicate record IDs.
    const merged = new Map<string, { record_id: string; score: number; channels: readonly string[] }>();
    const docPattern = `%${text}%`;
    const docs = db.prepare(
      `SELECT record_id,
              CASE WHEN text LIKE ? THEN 2.0 ELSE 1.0 END AS score
         FROM memory_search
        WHERE text LIKE ? OR fields_json LIKE ?
        ORDER BY score DESC, record_id ASC LIMIT ?`
    ).all(docPattern, docPattern, docPattern, limit) as Array<{ record_id: string; score: number }>;
    for (const doc of docs) merged.set(doc.record_id, { ...doc, channels: ['backend.search'] });

    if (ftsTableExists(db)) {
      try {
        const rows = db.prepare(
          `SELECT card_id AS record_id, bm25(card_fts) AS score
             FROM card_fts JOIN cards ON cards.id = card_fts.card_id
            WHERE card_fts MATCH ? AND cards.is_deleted = 0${scopeClause}
            ORDER BY score ASC LIMIT ?`
        ).all(text, limit) as Array<{ record_id: string; score: number }>;
        for (const row of rows) {
          const hit = { record_id: row.record_id, score: -row.score, channels: ['fts'] as const };
          const current = merged.get(row.record_id);
          if (!current || hit.score > current.score) merged.set(row.record_id, hit);
        }
      } catch {
        // Fall through to deterministic LIKE search for old/partial indexes.
      }
    }

    const pattern = `%${text}%`;
    const rows = db.prepare(
      `SELECT id AS record_id,
              CASE WHEN title LIKE ? THEN 3.0
                   WHEN summary LIKE ? THEN 2.0
                   ELSE 1.0 END AS score
         FROM cards
        WHERE is_deleted = 0
          AND (title LIKE ? OR summary LIKE ?)${scopeClause}
        ORDER BY score DESC, id ASC LIMIT ?`
    ).all(pattern, pattern, pattern, pattern, limit) as Array<{ record_id: string; score: number }>;
    for (const row of rows) {
      const current = merged.get(row.record_id);
      if (!current || row.score > current.score) merged.set(row.record_id, { ...row, channels: ['like'] });
    }
    return {
      hits: [...merged.values()]
        .sort((left, right) => right.score - left.score || left.record_id.localeCompare(right.record_id))
        .slice(0, limit),
    };
  }

  listEvents(options: MemoryHistoryOptions & { recordId?: string } = {}): readonly MemoryEvent[] {
    const db = this.requireDb();
    const limit = normalizeLimit(options.limit);
    // A record-scoped read is used by the T-1/T diff path. Read the newest
    // bounded window first so a long event log cannot make diff select the
    // oldest states. Reverse after filtering to preserve the public timeline
    // contract's ascending order.
    const order = options.recordId
      ? 'ORDER BY created_at DESC, rowid DESC'
      : 'ORDER BY created_at ASC, rowid ASC';
    const rows = db.prepare(
      `SELECT id, event_type, type, memory_id, branch, scope, payload, payload_json, created_at
         FROM events
        WHERE (? IS NULL OR created_at >= ?)
          AND (? IS NULL OR created_at <= ?)
        ${order}
        LIMIT ?`
    ).all(options.from ?? null, options.from ?? null, options.to ?? null, options.to ?? null, 500) as Array<{
      id: number;
      event_type: string | null;
      type: string | null;
      memory_id: string | null;
      branch: string | null;
      scope: string | null;
      payload: string | null;
      payload_json: string | null;
      created_at: string;
    }>;
    const recordId = options.recordId;
    const events = rows
      .map(row => {
        const payload = objectJson(row.payload_json ?? row.payload ?? '{}');
        return {
          id: String(row.id),
          // Prefer the namespaced event_type: legacy core rows may keep the
          // compatibility type column as `observe` for newer event names.
          type: sqliteEventType(row.event_type ?? row.type),
          scope: row.scope ?? (row.branch ? `branch:${row.branch}` : 'project'),
          occurred_at: row.created_at,
          recorded_at: row.created_at,
          created_at: row.created_at,
          payload,
          ...(row.memory_id ? { record_id: row.memory_id } : {}),
        } satisfies MemoryEvent;
      })
      .filter(event => !recordId || event.record_id === recordId || payloadRecordId(event.payload) === recordId)
    if (recordId) return events.slice(0, limit).reverse();
    return events.slice(0, limit);
  }

  beginTransaction(options?: BackendTransactionOptions): BackendTransaction {
    const db = this.requireDb();
    if (db.inTransaction) throw new Error('SQLite backend already has an active transaction.');
    db.exec('BEGIN IMMEDIATE');
    return new SqliteBackendTransaction(db, options?.correlation_id);
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) throw new Error('SQLite backend is not open.');
    return this.db;
  }
}

class SqliteBackendTransaction implements BackendTransaction {
  readonly atomic = true;
  readonly id: string;
  private done = false;

  constructor(private readonly db: SqliteDatabase, correlationId?: string) {
    this.id = correlationId ?? crypto.randomUUID();
  }

  getRecord(id: string): MemoryRecord | null {
    this.assertActive();
    const canonical = this.db.prepare(
      `SELECT id, schema_id, schema_version, data_json, scope_json, provenance_json,
              state, record_version, created_at, updated_at, is_deleted
         FROM memory_records WHERE id = ? LIMIT 1`
    ).get(id) as CanonicalRecordRow | undefined;
    if (canonical) return canonical.is_deleted === 0 ? new SqliteMemoryCodec().decode(canonical) : null;
    const row = this.db.prepare(
      `SELECT id, type, title, status, file_path, summary, schema_version,
              created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
         FROM cards WHERE id = ? LIMIT 1`
    ).get(id) as CardRow | undefined;
    return row && row.is_deleted === 0 ? toRecord(row) : null;
  }

  putRecord(record: MemoryRecord): void {
    this.assertActive();
    const row = new SqliteMemoryCodec().encode(record);
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_records
        (id, schema_id, schema_version, data_json, scope_json, provenance_json,
         state, record_version, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.schema_id, row.schema_version, row.data_json, row.scope_json,
      row.provenance_json, row.state, row.record_version, row.created_at,
      row.updated_at, row.is_deleted,
    );
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_search (record_id, text, fields_json, embedding_json)
       VALUES (?, ?, ?, NULL)`
    ).run(record.id, searchableRecordText(record), JSON.stringify(record.data));
  }

  deleteRecord(id: string, event?: MemoryEvent): void {
    this.assertActive();
    this.db.prepare('UPDATE memory_records SET is_deleted = 1, state = ?, updated_at = ? WHERE id = ?').run('forgotten', new Date().toISOString(), id);
    this.db.prepare('UPDATE cards SET is_deleted = 1, status = ?, updated_at = ? WHERE id = ?').run('forgotten', new Date().toISOString(), id);
    this.db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?').run(id, id);
    this.db.prepare('DELETE FROM aliases WHERE card_id = ?').run(id);
    this.db.prepare('DELETE FROM tags WHERE card_id = ?').run(id);
    this.db.prepare('DELETE FROM paths WHERE card_id = ?').run(id);
    if (ftsTableExists(this.db)) this.db.prepare('DELETE FROM card_fts WHERE card_id = ?').run(id);
    this.db.prepare("UPDATE dirty_flags SET resolved_at = ? WHERE scope = 'card' AND target = ? AND resolved_at IS NULL")
      .run(new Date().toISOString(), id);
    if (event) this.appendEvent(event);
  }

  appendEvent(event: MemoryEvent): MemoryEvent {
    this.assertActive();
    const payload = JSON.stringify(event.payload ?? {});
    const numericId = Number(event.id);
    const scope = memoryScopeId(event.scope);
    const branch = scope.startsWith('branch:')
      ? scope.slice('branch:'.length)
      : stringValue(event.payload.branch) ?? null;
    if (Number.isInteger(numericId) && numericId > 0) {
      this.db.prepare(
        `INSERT OR REPLACE INTO events
          (id, event_type, memory_id, branch, payload, created_at, success, type, scope, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(numericId, backendEventType(event.type), event.record_id ?? null, branch, payload, event.recorded_at, event.type, scope, payload);
      return { ...event, id: String(numericId) };
    }
    const result = this.db.prepare(
      `INSERT INTO events
        (event_type, memory_id, branch, payload, created_at, success, type, scope, payload_json)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(backendEventType(event.type), event.record_id ?? null, branch, payload, event.recorded_at, event.type, scope, payload);
    return { ...event, id: String(result.lastInsertRowid) };
  }

  putRelation(relation: MemoryRelation): void {
    this.assertActive();
    this.db.prepare(
      `INSERT OR IGNORE INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at)
       VALUES (?, ?, ?, 'explicit', 1.0, ?, ?)`
    ).run(relation.from_id, relation.to_id, relation.type, relation.created_at ?? null, relation.created_at ?? null);
  }

  removeRelation(relation: Pick<MemoryRelation, 'from_id' | 'to_id' | 'type'>): void {
    this.assertActive();
    this.db.prepare('DELETE FROM edges WHERE from_id = ? AND to_id = ? AND type = ?').run(relation.from_id, relation.to_id, relation.type);
  }

  upsertSearchDocument(document: MemorySearchDocument): void {
    this.assertActive();
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_search (record_id, text, fields_json, embedding_json)
       VALUES (?, ?, ?, ?)`
    ).run(document.record_id, document.text ?? '', JSON.stringify(document.fields ?? {}), document.embedding ? JSON.stringify(document.embedding) : null);
  }

  query(query: BackendQuery): MemoryQueryResult {
    this.assertActive();
    return queryCanonicalRecords(this.db, query, new SqliteMemoryCodec());
  }

  commit(): void {
    this.assertActive();
    this.db.exec('COMMIT');
    this.done = true;
  }

  rollback(_reason?: unknown): void {
    if (this.done) return;
    try { this.db.exec('ROLLBACK'); } finally { this.done = true; }
  }

  private assertActive(): void {
    if (this.done) throw new Error(`SQLite backend transaction ${this.id} is already closed.`);
  }
}

function toRecord(row: CardRow): MemoryRecord {
  const version = row.schema_version ?? 'legacy';
  return {
    id: row.id,
    schema: { id: row.type || 'memory', version },
    data: {
      type: row.type,
      title: row.title,
      status: row.status,
      file_path: row.file_path,
      summary: row.summary,
      confidence: row.confidence,
      trust_label: row.trust_label,
      sensitivity: row.sensitivity,
    },
    scope: 'project',
    provenance: { source: 'sqlite', source_id: row.file_path },
    created_at: row.created_at ?? row.updated_at ?? new Date(0).toISOString(),
    updated_at: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
    state: row.status === 'forgotten' ? 'forgotten' : 'active',
  };
}

function queryCanonicalRecords(db: SqliteDatabase, query: BackendQuery, codec: MemoryCodec): MemoryQueryResult {
  const params: unknown[] = [];
  const where = ['is_deleted = 0'];
  if (query.schema) {
    where.push('schema_id = ? AND schema_version = ?');
    params.push(query.schema.id, query.schema.version);
  }
  if (query.scope) {
    const scopes = (Array.isArray(query.scope) ? query.scope : [query.scope]).map(memoryScopeId);
    if (scopes.length === 0) return { records: [], total: 0 };
    where.push(`json_extract(scope_json, '$.id') IN (${scopes.map(() => '?').join(', ')}) OR scope_json IN (${scopes.map(() => '?').join(', ')})`);
    params.push(...scopes, ...scopes.map(scope => JSON.stringify(scope)));
  }
  const rows = db.prepare(
    `SELECT id, schema_id, schema_version, data_json, scope_json, provenance_json,
            state, record_version, created_at, updated_at, is_deleted
       FROM memory_records WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id ASC LIMIT ?`
  ).all(...params, 500) as CanonicalRecordRow[];
  const filtered = rows.map(row => codec.decode(row))
    .filter(record => matchesFilters(record, query.filters))
    .filter(record => matchesRelation(db, record.id, query.relation));
  return { records: filtered.slice(0, normalizeLimit(query.limit)), total: filtered.length };
}

function matchesRelation(db: SqliteDatabase, id: string, relation?: BackendQuery['relation']): boolean {
  if (!relation?.from_id && !relation?.to_id) return true;
  if (relation.from_id) {
    const row = db.prepare(`SELECT 1 FROM edges WHERE from_id = ? AND to_id = ?${relation.type ? ' AND type = ?' : ''} LIMIT 1`)
      .get(relation.from_id, id, ...(relation.type ? [relation.type] : []));
    if (!row) return false;
  }
  if (relation.to_id) {
    const row = db.prepare(`SELECT 1 FROM edges WHERE from_id = ? AND to_id = ?${relation.type ? ' AND type = ?' : ''} LIMIT 1`)
      .get(id, relation.to_id, ...(relation.type ? [relation.type] : []));
    if (!row) return false;
  }
  return true;
}

function searchableRecordText(record: MemoryRecord): string {
  return [record.id, record.schema.id, ...Object.values(record.data).filter(value => typeof value === 'string') as string[]].join(' ');
}

function matchesFilters(record: MemoryRecord, filters?: readonly import('../runtime/model').MemoryFilter[]): boolean {
  return (filters ?? []).every(filter => {
    const value = filter.field === 'id' ? record.id
      : filter.field === 'state' ? record.state
      : filter.field === 'schema.id' ? record.schema.id
      : filter.field === 'schema.version' ? record.schema.version
      : record.data[filter.field];
    const expected: any = filter.value;
    switch (filter.operator ?? 'eq') {
      case 'neq': return value !== expected;
      case 'in': return Array.isArray(expected) && expected.includes(value);
      case 'contains': return String(value ?? '').includes(String(expected));
      case 'gt': return (value as any) > expected;
      case 'gte': return (value as any) >= expected;
      case 'lt': return (value as any) < expected;
      case 'lte': return (value as any) <= expected;
      default: return value === expected;
    }
  });
}

function objectJson(value: string): Record<string, any> {
  const parsed = jsonValue(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
}

function jsonValue(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(500, Math.max(1, Math.floor(limit as number)));
}

function isSafeColumn(value: string): boolean {
  return /^(id|type|title|status|file_path|summary|schema_version|created_at|updated_at|confidence|trust_label|sensitivity)$/.test(value);
}

function scopeIncludesProject(scope: string | readonly string[]): boolean {
  return (Array.isArray(scope) ? scope : [scope]).includes('project');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function backendEventType(type: string): string {
  if (type === 'observe') return 'memory.observe';
  if (type === 'commit') return 'memory.capture.committed';
  if (type === 'forget') return 'memory.forget.tombstone';
  return `memory.${type}`;
}

function sqliteEventType(eventType?: string | null): MemoryEventType {
  if (eventType === 'memory.capture.committed') return 'commit';
  if (eventType === 'memory.forget.tombstone') return 'forget';
  if (eventType === 'memory.observe') return 'observe';
  if (eventType?.includes('session_end')) return 'session_end';
  if (eventType?.includes('supersede')) return 'supersede';
  return (eventType?.replace(/^memory\./, '') || 'observe') as MemoryEventType;
}

function payloadRecordId(payload: Record<string, unknown>): string | undefined {
  for (const key of ['record_id', 'memory_id', 'target_id']) {
    if (typeof payload[key] === 'string') return payload[key] as string;
  }
  return undefined;
}
