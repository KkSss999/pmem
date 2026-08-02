import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import {
  createFTS5,
  createSchema,
  ftsTableExists,
  openOwnedDatabase,
} from '../core/db';
import type {
  BackendCapabilities,
  BackendOpenContext,
  BackendQuery,
  BackendTransaction,
  BackendTransactionOptions,
  MaybePromise,
  MemoryBackend,
  MemoryEvent,
  MemoryJsonObject,
  MemoryProvenance,
  MemoryQueryResult,
  MemoryRecord,
  MemoryRelation,
  MemorySchemaRegistry,
  MemorySearchDocument,
  MemorySearchRequest,
  MemorySearchResult,
} from '../runtime/model';

/** Kept as an exported alias so Runtime never imports better-sqlite3 directly. */
export type SqliteDatabase = Database.Database;

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

/**
 * SQLite implementation of the v1.3 backend port.
 *
 * Existing pmem tables remain the compatibility storage format. Canonical
 * records/events are translated at this boundary and never leak SQLite rows
 * into Runtime contracts.
 */
export class SqliteMemoryBackend implements MemoryBackend {
  readonly id = 'sqlite';
  readonly capabilities = SQLITE_BACKEND_CAPABILITIES;
  private db: SqliteDatabase | null = null;

  constructor(private readonly pmemPath: string) {}

  get database(): SqliteDatabase | null {
    return this.db;
  }

  open(_context: BackendOpenContext): void {
    if (this.db) return;
    this.db = openOwnedDatabase(this.pmemPath);
    createSchema(this.db);
    createFTS5(this.db);
    this.db.exec(`
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
    const row = db.prepare(
      `SELECT id, type, title, status, file_path, summary, schema_version,
              created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
         FROM cards WHERE id = ? LIMIT 1`
    ).get(id) as CardRow | undefined;
    return row && row.is_deleted === 0 ? toRecord(row) : null;
  }

  query(query: BackendQuery): MemoryQueryResult {
    const db = this.requireDb();
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
      const scopes = Array.isArray(query.scope) ? query.scope : [query.scope];
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
    return { records: rows.map(toRecord), total: rows.length };
  }

  search(request: MemorySearchRequest): MemorySearchResult {
    const db = this.requireDb();
    const text = request.text?.trim() ?? '';
    const limit = normalizeLimit(request.limit);
    const scopeClause = request.scope && !scopeIncludesProject(request.scope)
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
    const row = this.db.prepare(
      `SELECT id, type, title, status, file_path, summary, schema_version,
              created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
         FROM cards WHERE id = ? LIMIT 1`
    ).get(id) as CardRow | undefined;
    return row && row.is_deleted === 0 ? toRecord(row) : null;
  }

  putRecord(record: MemoryRecord): void {
    this.assertActive();
    const data = record.data;
    const title = stringValue(data.title) ?? record.id;
    const type = stringValue(data.type) ?? record.schema.id;
    const filePath = stringValue(data.file_path) ?? `.runtime/${record.id}.json`;
    const summary = stringValue(data.summary) ?? null;
    const bodyHash = hash(JSON.stringify(data));
    this.db.prepare(`
      INSERT OR REPLACE INTO cards
        (id, type, title, status, file_path, summary, schema_version,
         created_at, updated_at, file_hash, frontmatter_hash, body_hash,
         token_count, section_count, is_deleted, is_candidate, confidence,
         trust_label, sensitivity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)
    `).run(
      record.id, type, title, stringValue(data.status) ?? record.state ?? 'active',
      filePath, summary, record.schema.version, record.created_at, record.updated_at,
      bodyHash, bodyHash, bodyHash, record.provenance.confidence ?? null,
      stringValue(record.provenance.metadata?.trust_label), stringValue(record.provenance.metadata?.sensitivity),
    );
  }

  deleteRecord(id: string, event?: MemoryEvent): void {
    this.assertActive();
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
    const branch = event.scope.startsWith('branch:')
      ? event.scope.slice('branch:'.length)
      : stringValue(event.payload.branch) ?? null;
    if (Number.isInteger(numericId) && numericId > 0) {
      this.db.prepare(
        `INSERT OR REPLACE INTO events
          (id, event_type, memory_id, branch, payload, created_at, success, type, scope, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(numericId, backendEventType(event.type), event.record_id ?? null, branch, payload, event.created_at, event.type, event.scope, payload);
      return { ...event, id: String(numericId) };
    }
    const result = this.db.prepare(
      `INSERT INTO events
        (event_type, memory_id, branch, payload, created_at, success, type, scope, payload_json)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(backendEventType(event.type), event.record_id ?? null, branch, payload, event.created_at, event.type, event.scope, payload);
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
    // Keep transaction reads on the same connection so uncommitted writes are visible.
    const params: unknown[] = [];
    const where: string[] = ['is_deleted = 0'];
    if (query.schema) { where.push('schema_version = ?'); params.push(query.schema.version); }
    if (query.scope && !scopeIncludesProject(query.scope)) return { records: [], total: 0 };
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
    const limit = normalizeLimit(query.limit);
    params.push(limit);
    const rows = this.db.prepare(
      `SELECT id, type, title, status, file_path, summary, schema_version,
              created_at, updated_at, confidence, trust_label, sensitivity, is_deleted
         FROM cards WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id ASC LIMIT ?`
    ).all(...params) as CardRow[];
    return { records: rows.map(toRecord), total: rows.length };
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
