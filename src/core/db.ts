import Database from 'better-sqlite3';
import * as path from 'path';
import { ensureDir } from './fs';
import type { EdgeRow } from '../types';

export const CORE_SCHEMA_VERSION = '0.5';

let _db: Database.Database | null = null;

function openSqliteDatabase(pmemPath: string): Database.Database {
  ensureDir(pmemPath);
  const dbPath = path.join(pmemPath, 'pmem.db');
  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (err: any) {
    if (err?.code === 'SQLITE_NOTADB') {
      const msg = `.pmem/pmem.db exists but is not a valid SQLite database.\n` +
        `Back up the file if needed, then run: pmem rebuild --full`;
      throw new Error(msg);
    }
    throw err;
  }
}

export function openDatabase(pmemPath: string): Database.Database {
  if (_db) return _db;
  try {
    _db = openSqliteDatabase(pmemPath);
  } catch (err) {
    _db = null;
    throw err;
  }
  return _db;
}

export function openOwnedDatabase(pmemPath: string): Database.Database {
  return openSqliteDatabase(pmemPath);
}

export function closeDatabase(db?: Database.Database): void {
  if (db) {
    try { db.close(); } catch {}
    if (db === _db) _db = null;
    return;
  }
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getDatabase(): Database.Database | null {
  return _db;
}

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT,
      priority TEXT,
      file_path TEXT NOT NULL UNIQUE,
      summary TEXT,
      schema_version TEXT,
      card_version INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      last_verified_at TEXT,
      file_hash TEXT NOT NULL,
      frontmatter_hash TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      section_count INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      is_candidate INTEGER DEFAULT 0,
      confidence REAL,
      superseded_by TEXT,
      classification TEXT,
      trust_label TEXT,
      sensitivity TEXT
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'explicit',
      confidence REAL DEFAULT 1.0,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(from_id, to_id, type, source)
    );

    CREATE TABLE IF NOT EXISTS aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      language TEXT,
      UNIQUE(card_id, normalized_alias)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      normalized_tag TEXT NOT NULL,
      UNIQUE(card_id, normalized_tag)
    );

    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      path TEXT NOT NULL,
      relation TEXT NOT NULL,
      UNIQUE(card_id, path, relation)
    );

    CREATE TABLE IF NOT EXISTS dirty_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      task_summary TEXT,
      base_index_hash TEXT,
      status TEXT,
      dirty INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS update_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      summary TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      affected_cards TEXT,
      affected_paths TEXT,
      success INTEGER NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      memory_id TEXT,
      branch TEXT,
      payload TEXT,
      created_at TEXT NOT NULL,
      session_id TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      type TEXT,
      scope TEXT,
      payload_json TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS semantic_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pipeline_version INTEGER NOT NULL DEFAULT 1,
      model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      index_content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      built_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS semantic_chunks (
      chunk_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      heading TEXT,
      heading_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      context_hash TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_card_id
      ON semantic_chunks(card_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_content_hash
      ON semantic_chunks(content_hash);
  `);

  for (const column of [
    'event_type TEXT', 'memory_id TEXT', 'branch TEXT', 'payload TEXT',
    'session_id TEXT', 'success INTEGER NOT NULL DEFAULT 1',
    'type TEXT', 'scope TEXT', 'payload_json TEXT', 'expires_at TEXT'
  ]) {
    try { db.exec(`ALTER TABLE events ADD COLUMN ${column}`); } catch {}
  }

  try { db.exec('ALTER TABLE semantic_meta ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 1'); } catch {}
  try { db.exec("ALTER TABLE semantic_chunks ADD COLUMN context TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE semantic_chunks ADD COLUMN context_hash TEXT NOT NULL DEFAULT ''"); } catch {}

  // v1.1: agent-trust columns on existing cards tables (idempotent).
  for (const column of [
    'confidence REAL', 'superseded_by TEXT', 'classification TEXT',
    'trust_label TEXT', 'sensitivity TEXT'
  ]) {
    try { db.exec(`ALTER TABLE cards ADD COLUMN ${column}`); } catch {}
  }

  setSchemaVersion(db, CORE_SCHEMA_VERSION);
}

export function hasFTS5(db: Database.Database): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(content); DROP TABLE IF EXISTS _fts5_test;");
    return true;
  } catch {
    return false;
  }
}

export function createFTS5(db: Database.Database): void {
  if (!hasFTS5(db)) return;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS card_fts USING fts5(
      card_id UNINDEXED,
      title,
      summary,
      body,
      aliases,
      tags
    );
  `);
}

export function ftsTableExists(db: Database.Database): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_fts'"
    ).get();
    return !!row;
  } catch {
    return false;
  }
}

export interface CardFtsRow {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  aliases: string[];
  tags: string[];
}

export function refreshCardFts(db: Database.Database, card: CardFtsRow): void {
  if (!ftsTableExists(db)) return;
  db.prepare('DELETE FROM card_fts WHERE card_id = ?').run(card.id);
  db.prepare(
    'INSERT INTO card_fts (card_id, title, summary, body, aliases, tags) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(card.id, card.title, card.summary ?? '', card.body, card.aliases.join(' '), card.tags.join(' '));
}

export function deleteCardFts(db: Database.Database, cardId: string): void {
  if (!ftsTableExists(db)) return;
  db.prepare('DELETE FROM card_fts WHERE card_id = ?').run(cardId);
}

export function cardFtsRowExists(db: Database.Database, cardId: string): boolean {
  if (!ftsTableExists(db)) return false;
  const row = db.prepare('SELECT card_id FROM card_fts WHERE card_id = ? LIMIT 1').get(cardId);
  return !!row;
}

export function clearCardFts(db: Database.Database): void {
  if (!ftsTableExists(db)) return;
  db.exec('DELETE FROM card_fts');
}

export function getSchemaVersion(db: Database.Database): string | null {
  try {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setSchemaVersion(db: Database.Database, version: string): void {
  db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(version);
}

// Bulk insert helpers using transactions

export function upsertCard(db: Database.Database, card: import('../types').CardRow): void {
  // Normalize superseded_by (array in frontmatter) to a JSON string for storage.
  const supersededBy = Array.isArray(card.superseded_by)
    ? (card.superseded_by.length > 0 ? JSON.stringify(card.superseded_by) : null)
    : (card.superseded_by ?? null);
  // Build an explicit param object so new/optional columns default to null
  // rather than throwing on callers that don't set them.
  const params = {
    id: card.id,
    type: card.type,
    title: card.title,
    status: card.status ?? null,
    priority: card.priority ?? null,
    file_path: card.file_path,
    summary: card.summary ?? null,
    schema_version: card.schema_version ?? null,
    card_version: card.card_version ?? 1,
    created_at: card.created_at ?? null,
    updated_at: card.updated_at ?? null,
    last_verified_at: card.last_verified_at ?? null,
    file_hash: card.file_hash,
    frontmatter_hash: card.frontmatter_hash,
    body_hash: card.body_hash,
    token_count: card.token_count ?? 0,
    section_count: card.section_count ?? 0,
    is_deleted: card.is_deleted ?? 0,
    is_candidate: card.is_candidate ?? 0,
    confidence: card.confidence ?? null,
    superseded_by: supersededBy,
    classification: card.classification ?? null,
    trust_label: card.trust_label ?? null,
    sensitivity: card.sensitivity ?? null,
  };
  db.prepare(`
    INSERT OR REPLACE INTO cards (id, type, title, status, priority, file_path, summary,
      schema_version, card_version, created_at, updated_at, last_verified_at,
      file_hash, frontmatter_hash, body_hash, token_count, section_count, is_deleted, is_candidate,
      confidence, superseded_by, classification, trust_label, sensitivity)
    VALUES (@id, @type, @title, @status, @priority, @file_path, @summary,
      @schema_version, @card_version, @created_at, @updated_at, @last_verified_at,
      @file_hash, @frontmatter_hash, @body_hash, @token_count, @section_count, @is_deleted, @is_candidate,
      @confidence, @superseded_by, @classification, @trust_label, @sensitivity)
  `).run(params);
}

export function deleteCardEdges(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM edges WHERE from_id = ?").run(cardId);
}

export function deleteExplicitCardEdges(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM edges WHERE from_id = ? AND source = 'explicit'").run(cardId);
}

export function deleteMentionEdges(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM edges WHERE from_id = ? AND source = 'mention'").run(cardId);
}

/**
 * v0.7.3 (issue #6): per-card inferred edge cleanup.
 *
 * Rebuilds need to re-derive inferred edges (e.g. task→module
 * next_step_of) from the card's *current* frontmatter. Without this,
 * an incremental rebuild that only re-processes one card would leave
 * stale inferred edges in the DB that point to modules the card no
 * longer references. Used by `rebuildCommand` for every re-processed
 * card, in both full and incremental modes.
 */
export function deleteInferredCardEdges(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM edges WHERE from_id = ? AND source = 'inferred'").run(cardId);
}

export function insertEdge(db: Database.Database, edge: import('../types').EdgeRow): void {
  db.prepare(`
    INSERT OR IGNORE INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at)
    VALUES (@from_id, @to_id, @type, @source, @confidence, @created_at, @updated_at)
  `).run({
    ...edge,
    created_at: edge.created_at ?? null,
    updated_at: edge.updated_at ?? null,
  });
}

export function deleteCardAliases(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM aliases WHERE card_id = ?").run(cardId);
}

export function insertAlias(db: Database.Database, cardId: string, alias: string, language?: string): void {
  const normalized = alias.toLowerCase().trim();
  db.prepare("INSERT OR IGNORE INTO aliases (card_id, alias, normalized_alias, language) VALUES (?, ?, ?, ?)")
    .run(cardId, alias, normalized, language ?? null);
}

export function deleteCardTags(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM tags WHERE card_id = ?").run(cardId);
}

export function insertTag(db: Database.Database, cardId: string, tag: string): void {
  const normalized = tag.toLowerCase().trim();
  db.prepare("INSERT OR IGNORE INTO tags (card_id, tag, normalized_tag) VALUES (?, ?, ?)")
    .run(cardId, tag, normalized);
}

export function deleteCardPaths(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM paths WHERE card_id = ?").run(cardId);
}

export function insertPath(db: Database.Database, cardId: string, filePath: string, relation: string): void {
  db.prepare("INSERT OR IGNORE INTO paths (card_id, path, relation) VALUES (?, ?, ?)")
    .run(cardId, filePath, relation);
}

export function clearAllTables(db: Database.Database): void {
  db.exec(`
    DELETE FROM semantic_chunks;
    DELETE FROM semantic_meta;
    DELETE FROM paths;
    DELETE FROM tags;
    DELETE FROM aliases;
    DELETE FROM edges;
    DELETE FROM cards;
    DELETE FROM dirty_flags;
    DELETE FROM update_log;
    DELETE FROM sessions;
    DELETE FROM events;
  `);
}

export function getCardHash(db: Database.Database, filePath: string): { file_hash: string; frontmatter_hash: string; body_hash: string } | null {
  const row = db.prepare("SELECT file_hash, frontmatter_hash, body_hash FROM cards WHERE file_path = ?").get(filePath) as
    { file_hash: string; frontmatter_hash: string; body_hash: string } | undefined;
  return row ?? null;
}

// === P1: dirty_flags helpers ===

export function insertDirtyFlag(db: Database.Database, scope: string, target: string, reason: string, sessionId?: string): void {
  db.prepare(
    "INSERT INTO dirty_flags (scope, target, reason, created_at, session_id) VALUES (?, ?, ?, ?, ?)"
  ).run(scope, target, reason, new Date().toISOString(), sessionId ?? null);
}

export function resolveDirtyFlags(db: Database.Database, scope?: string, target?: string): number {
  const now = new Date().toISOString();
  if (scope && target) {
    return db.prepare(
      "UPDATE dirty_flags SET resolved_at = ? WHERE scope = ? AND target = ? AND resolved_at IS NULL"
    ).run(now, scope, target).changes;
  }
  return db.prepare(
    "UPDATE dirty_flags SET resolved_at = ? WHERE resolved_at IS NULL"
  ).run(now).changes;
}

export function getUnresolvedDirtyFlags(db: Database.Database): Array<{ scope: string; target: string; reason: string; created_at: string }> {
  return db.prepare(
    "SELECT scope, target, reason, created_at FROM dirty_flags WHERE resolved_at IS NULL ORDER BY created_at DESC"
  ).all() as Array<{ scope: string; target: string; reason: string; created_at: string }>;
}

export interface DirtyFlagDetailed {
  id: number;
  scope: string;
  target: string;
  reason: string;
  created_at: string;
  session_id: string | null;
}

export function getUnresolvedDirtyFlagsDetailed(db: Database.Database): DirtyFlagDetailed[] {
  return db.prepare(
    "SELECT id, scope, target, reason, created_at, session_id FROM dirty_flags WHERE resolved_at IS NULL ORDER BY created_at DESC"
  ).all() as DirtyFlagDetailed[];
}

// === P1: sessions helpers ===

export function startSession(db: Database.Database, id: string, agentName?: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO sessions (id, agent_name, started_at, status, dirty) VALUES (?, ?, ?, 'active', 0)"
  ).run(id, agentName ?? null, new Date().toISOString());
}

export function endSession(db: Database.Database, id: string, status?: string, taskSummary?: string): void {
  db.prepare(
    "UPDATE sessions SET ended_at = ?, status = ?, task_summary = ? WHERE id = ?"
  ).run(new Date().toISOString(), status ?? 'completed', taskSummary ?? null, id);
}

export function getActiveSession(db: Database.Database): { id: string; agent_name: string | null; started_at: string } | null {
  const row = db.prepare(
    "SELECT id, agent_name, started_at FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
  ).get() as { id: string; agent_name: string | null; started_at: string } | undefined;
  return row ?? null;
}

// === P1: update_log helpers ===

export function insertUpdateLog(db: Database.Database, action: string, summary?: string, sessionId?: string, affectedCards?: string[], success?: boolean, error?: string): void {
  db.prepare(
    "INSERT INTO update_log (action, summary, session_id, created_at, affected_cards, affected_paths, success, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    action,
    summary ?? null,
    sessionId ?? null,
    new Date().toISOString(),
    affectedCards ? JSON.stringify(affectedCards) : null,
    null,
    success !== false ? 1 : 0,
    error ?? null
  );
}

export interface RuntimeEventInput {
  eventType: string;
  memoryId?: string | null;
  branch?: string | null;
  payload?: unknown;
  sessionId?: string | null;
  success?: boolean;
}

export interface RuntimeEventRow {
  id: number;
  event_type: string;
  memory_id: string | null;
  branch: string | null;
  payload: string | null;
  created_at: string;
  session_id: string | null;
  success: number;
  scope?: string | null;
}

export function insertRuntimeEvent(db: Database.Database, event: RuntimeEventInput): number {
  const payload = event.payload === undefined ? null : JSON.stringify(event.payload);
  const result = db.prepare(
    "INSERT INTO events (event_type, memory_id, branch, payload, created_at, session_id, success, type, scope, payload_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    event.eventType,
    event.memoryId ?? null,
    event.branch ?? null,
    payload,
    new Date().toISOString(),
    event.sessionId ?? null,
    event.success === false ? 0 : 1,
    toMemoryEventTypeForCore(event.eventType),
    event.branch ? `branch:${event.branch}` : 'project',
    payload,
    null
  );
  return Number(result.lastInsertRowid);
}

export function getRecentRuntimeEvents(db: Database.Database, limit: number = 10): RuntimeEventRow[] {
  return db.prepare(
    "SELECT id, event_type, memory_id, branch, payload, created_at, session_id, success, scope FROM events ORDER BY CASE WHEN event_type = 'memory.capture.committed' THEN 0 ELSE 1 END ASC, created_at DESC, rowid DESC LIMIT ?"
  ).all(limit) as RuntimeEventRow[];
}

export function getRuntimeEventsForMemory(db: Database.Database, memoryId: string): RuntimeEventRow[] {
  return db.prepare(
    "SELECT id, event_type, memory_id, branch, payload, created_at, session_id, success FROM events WHERE memory_id = ? ORDER BY created_at DESC, rowid DESC"
  ).all(memoryId) as RuntimeEventRow[];
}

export function getRecentUpdateLogs(db: Database.Database, limit: number = 10): Array<{ action: string; summary: string | null; created_at: string; success: number }> {
  return db.prepare(
    "SELECT action, summary, created_at, success FROM update_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<{ action: string; summary: string | null; created_at: string; success: number }>;
}

// === v0.6.3: Inferred edge CRUD ===

export function deleteInferredEdges(db: Database.Database): number {
  return db.prepare("DELETE FROM edges WHERE source = 'inferred'").run().changes;
}

export function getInferredEdges(db: Database.Database): EdgeRow[] {
  return db.prepare(
    "SELECT * FROM edges WHERE source = 'inferred' ORDER BY confidence DESC"
  ).all() as EdgeRow[];
}

export function getEdgesForCard(
  db: Database.Database,
  cardId: string,
  source?: 'explicit' | 'inferred' | 'mention'
): EdgeRow[] {
  let query = "SELECT * FROM edges WHERE (from_id = ? OR to_id = ?)";
  const params: unknown[] = [cardId, cardId];
  if (source) {
    query += " AND source = ?";
    params.push(source);
  }
  query += " ORDER BY confidence DESC";
  return db.prepare(query).all(...params) as EdgeRow[];
}

export function updateEdgeSource(
  db: Database.Database,
  edgeIds: number[],
  newSource: 'explicit' | 'inferred',
  newConfidence: number
): number {
  if (edgeIds.length === 0) return 0;
  const placeholders = edgeIds.map(() => '?').join(',');
  return db.prepare(
    `UPDATE edges SET source = ?, confidence = ?, updated_at = ? WHERE id IN (${placeholders})`
  ).run(newSource, newConfidence, new Date().toISOString(), ...edgeIds).changes;
}

export function deleteEdgesByIds(db: Database.Database, edgeIds: number[]): number {
  if (edgeIds.length === 0) return 0;
  const placeholders = edgeIds.map(() => '?').join(',');
  return db.prepare(
    `DELETE FROM edges WHERE id IN (${placeholders})`
  ).run(...edgeIds).changes;
}

export function getOrphanEdges(db: Database.Database): EdgeRow[] {
  return db.prepare(`
    SELECT e.* FROM edges e
    LEFT JOIN cards c1 ON e.from_id = c1.id
    LEFT JOIN cards c2 ON e.to_id = c2.id
    WHERE c1.id IS NULL OR c2.id IS NULL
  `).all() as EdgeRow[];
}

/**
 * v0.7.3 (issue #6): prune edges whose endpoints reference cards that
 * no longer exist in the `cards` table. Returns the number of rows
 * deleted. Called by `rebuildCommand --full` after the rebuild loop
 * so that a deleted-card file can't leave behind edges that point to
 * it. The matching `select` form lives in `getOrphanEdges` for ad-hoc
 * inspection.
 */
export function deleteOrphanEdges(db: Database.Database): number {
  return db.prepare(`
    DELETE FROM edges
    WHERE from_id NOT IN (SELECT id FROM cards WHERE is_deleted = 0)
       OR to_id   NOT IN (SELECT id FROM cards WHERE is_deleted = 0)
  `).run().changes;
}

export interface ForgetResult {
  success: boolean;
  memoryId: string;
  eventId?: number;
  message: string;
}

export function forgetMemory(db: Database.Database, memoryId: string, options: { reason?: string; branch?: string | null; sessionId?: string | null } = {}): ForgetResult {
  const tx = db.transaction((): ForgetResult => {
    const card = db.prepare("SELECT id, is_deleted FROM cards WHERE id = ?").get(memoryId) as { id: string; is_deleted: number } | undefined;
    if (!card) {
      return { success: false, memoryId, message: `Memory not found: ${memoryId}` };
    }
    if (card.is_deleted === 1) {
      const eventId = insertRuntimeEvent(db, {
        eventType: 'memory.forget.tombstone',
        memoryId,
        branch: options.branch ?? null,
        sessionId: options.sessionId ?? null,
        payload: { reason: options.reason ?? null, already_deleted: true },
        success: true,
      });
      return { success: true, memoryId, eventId, message: `Memory already forgotten: ${memoryId}` };
    }

    db.prepare("UPDATE cards SET is_deleted = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), memoryId);
    db.prepare("DELETE FROM edges WHERE from_id = ? OR to_id = ?").run(memoryId, memoryId);
    deleteCardAliases(db, memoryId);
    deleteCardTags(db, memoryId);
    deleteCardPaths(db, memoryId);
    deleteCardFts(db, memoryId);
    resolveDirtyFlags(db, 'card', memoryId);
    const eventId = insertRuntimeEvent(db, {
      eventType: 'memory.forget.tombstone',
      memoryId,
      branch: options.branch ?? null,
      sessionId: options.sessionId ?? null,
      payload: { reason: options.reason ?? null },
      success: true,
    });
    return { success: true, memoryId, eventId, message: `Memory forgotten: ${memoryId}` };
  });
  return tx();
}

function toMemoryEventTypeForCore(eventType: string): string {
  if (eventType === 'memory.capture.committed') return 'commit';
  if (eventType === 'memory.forget.tombstone') return 'forget';
  if (eventType === 'memory.observe') return 'observe';
  return 'observe';
}
