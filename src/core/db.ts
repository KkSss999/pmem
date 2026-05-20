import Database from 'better-sqlite3';
import * as path from 'path';
import { ensureDir } from './fs';

let _db: Database.Database | null = null;

export function openDatabase(pmemPath: string): Database.Database {
  if (_db) return _db;
  ensureDir(pmemPath);
  const dbPath = path.join(pmemPath, 'pmem.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function closeDatabase(): void {
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
      is_candidate INTEGER DEFAULT 0
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
  `);
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
  db.prepare(`
    INSERT OR REPLACE INTO cards (id, type, title, status, priority, file_path, summary,
      schema_version, card_version, created_at, updated_at, last_verified_at,
      file_hash, frontmatter_hash, body_hash, token_count, section_count, is_deleted, is_candidate)
    VALUES (@id, @type, @title, @status, @priority, @file_path, @summary,
      @schema_version, @card_version, @created_at, @updated_at, @last_verified_at,
      @file_hash, @frontmatter_hash, @body_hash, @token_count, @section_count, @is_deleted, @is_candidate)
  `).run(card);
}

export function deleteCardEdges(db: Database.Database, cardId: string): void {
  db.prepare("DELETE FROM edges WHERE from_id = ?").run(cardId);
}

export function insertEdge(db: Database.Database, edge: import('../types').EdgeRow): void {
  db.prepare(`
    INSERT OR IGNORE INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at)
    VALUES (@from_id, @to_id, @type, @source, @confidence, @created_at, @updated_at)
  `).run(edge);
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
    DELETE FROM paths;
    DELETE FROM tags;
    DELETE FROM aliases;
    DELETE FROM edges;
    DELETE FROM cards;
    DELETE FROM dirty_flags;
    DELETE FROM update_log;
    DELETE FROM sessions;
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

export function getRecentUpdateLogs(db: Database.Database, limit: number = 10): Array<{ action: string; summary: string | null; created_at: string; success: number }> {
  return db.prepare(
    "SELECT action, summary, created_at, success FROM update_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<{ action: string; summary: string | null; created_at: string; success: number }>;
}
