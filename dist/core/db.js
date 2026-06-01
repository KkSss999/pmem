"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDatabase = openDatabase;
exports.closeDatabase = closeDatabase;
exports.getDatabase = getDatabase;
exports.createSchema = createSchema;
exports.hasFTS5 = hasFTS5;
exports.createFTS5 = createFTS5;
exports.getSchemaVersion = getSchemaVersion;
exports.setSchemaVersion = setSchemaVersion;
exports.upsertCard = upsertCard;
exports.deleteCardEdges = deleteCardEdges;
exports.deleteExplicitCardEdges = deleteExplicitCardEdges;
exports.insertEdge = insertEdge;
exports.deleteCardAliases = deleteCardAliases;
exports.insertAlias = insertAlias;
exports.deleteCardTags = deleteCardTags;
exports.insertTag = insertTag;
exports.deleteCardPaths = deleteCardPaths;
exports.insertPath = insertPath;
exports.clearAllTables = clearAllTables;
exports.getCardHash = getCardHash;
exports.insertDirtyFlag = insertDirtyFlag;
exports.resolveDirtyFlags = resolveDirtyFlags;
exports.getUnresolvedDirtyFlags = getUnresolvedDirtyFlags;
exports.getUnresolvedDirtyFlagsDetailed = getUnresolvedDirtyFlagsDetailed;
exports.startSession = startSession;
exports.endSession = endSession;
exports.getActiveSession = getActiveSession;
exports.insertUpdateLog = insertUpdateLog;
exports.getRecentUpdateLogs = getRecentUpdateLogs;
exports.deleteInferredEdges = deleteInferredEdges;
exports.getInferredEdges = getInferredEdges;
exports.getEdgesForCard = getEdgesForCard;
exports.updateEdgeSource = updateEdgeSource;
exports.deleteEdgesByIds = deleteEdgesByIds;
exports.getOrphanEdges = getOrphanEdges;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path = __importStar(require("path"));
const fs_1 = require("./fs");
let _db = null;
function openDatabase(pmemPath) {
    if (_db)
        return _db;
    (0, fs_1.ensureDir)(pmemPath);
    const dbPath = path.join(pmemPath, 'pmem.db');
    try {
        _db = new better_sqlite3_1.default(dbPath);
        _db.pragma('journal_mode = WAL');
        _db.pragma('foreign_keys = ON');
    }
    catch (err) {
        _db = null;
        if (err?.code === 'SQLITE_NOTADB') {
            const msg = `.pmem/pmem.db exists but is not a valid SQLite database.\n` +
                `Back up the file if needed, then run: pmem rebuild --full`;
            throw new Error(msg);
        }
        throw err;
    }
    return _db;
}
function closeDatabase() {
    if (_db) {
        _db.close();
        _db = null;
    }
}
function getDatabase() {
    return _db;
}
function createSchema(db) {
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
function hasFTS5(db) {
    try {
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(content); DROP TABLE IF EXISTS _fts5_test;");
        return true;
    }
    catch {
        return false;
    }
}
function createFTS5(db) {
    if (!hasFTS5(db))
        return;
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
function getSchemaVersion(db) {
    try {
        const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
        return row?.value ?? null;
    }
    catch {
        return null;
    }
}
function setSchemaVersion(db, version) {
    db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(version);
}
// Bulk insert helpers using transactions
function upsertCard(db, card) {
    db.prepare(`
    INSERT OR REPLACE INTO cards (id, type, title, status, priority, file_path, summary,
      schema_version, card_version, created_at, updated_at, last_verified_at,
      file_hash, frontmatter_hash, body_hash, token_count, section_count, is_deleted, is_candidate)
    VALUES (@id, @type, @title, @status, @priority, @file_path, @summary,
      @schema_version, @card_version, @created_at, @updated_at, @last_verified_at,
      @file_hash, @frontmatter_hash, @body_hash, @token_count, @section_count, @is_deleted, @is_candidate)
  `).run(card);
}
function deleteCardEdges(db, cardId) {
    db.prepare("DELETE FROM edges WHERE from_id = ?").run(cardId);
}
function deleteExplicitCardEdges(db, cardId) {
    db.prepare("DELETE FROM edges WHERE from_id = ? AND source = 'explicit'").run(cardId);
}
function insertEdge(db, edge) {
    db.prepare(`
    INSERT OR IGNORE INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at)
    VALUES (@from_id, @to_id, @type, @source, @confidence, @created_at, @updated_at)
  `).run(edge);
}
function deleteCardAliases(db, cardId) {
    db.prepare("DELETE FROM aliases WHERE card_id = ?").run(cardId);
}
function insertAlias(db, cardId, alias, language) {
    const normalized = alias.toLowerCase().trim();
    db.prepare("INSERT OR IGNORE INTO aliases (card_id, alias, normalized_alias, language) VALUES (?, ?, ?, ?)")
        .run(cardId, alias, normalized, language ?? null);
}
function deleteCardTags(db, cardId) {
    db.prepare("DELETE FROM tags WHERE card_id = ?").run(cardId);
}
function insertTag(db, cardId, tag) {
    const normalized = tag.toLowerCase().trim();
    db.prepare("INSERT OR IGNORE INTO tags (card_id, tag, normalized_tag) VALUES (?, ?, ?)")
        .run(cardId, tag, normalized);
}
function deleteCardPaths(db, cardId) {
    db.prepare("DELETE FROM paths WHERE card_id = ?").run(cardId);
}
function insertPath(db, cardId, filePath, relation) {
    db.prepare("INSERT OR IGNORE INTO paths (card_id, path, relation) VALUES (?, ?, ?)")
        .run(cardId, filePath, relation);
}
function clearAllTables(db) {
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
function getCardHash(db, filePath) {
    const row = db.prepare("SELECT file_hash, frontmatter_hash, body_hash FROM cards WHERE file_path = ?").get(filePath);
    return row ?? null;
}
// === P1: dirty_flags helpers ===
function insertDirtyFlag(db, scope, target, reason, sessionId) {
    db.prepare("INSERT INTO dirty_flags (scope, target, reason, created_at, session_id) VALUES (?, ?, ?, ?, ?)").run(scope, target, reason, new Date().toISOString(), sessionId ?? null);
}
function resolveDirtyFlags(db, scope, target) {
    const now = new Date().toISOString();
    if (scope && target) {
        return db.prepare("UPDATE dirty_flags SET resolved_at = ? WHERE scope = ? AND target = ? AND resolved_at IS NULL").run(now, scope, target).changes;
    }
    return db.prepare("UPDATE dirty_flags SET resolved_at = ? WHERE resolved_at IS NULL").run(now).changes;
}
function getUnresolvedDirtyFlags(db) {
    return db.prepare("SELECT scope, target, reason, created_at FROM dirty_flags WHERE resolved_at IS NULL ORDER BY created_at DESC").all();
}
function getUnresolvedDirtyFlagsDetailed(db) {
    return db.prepare("SELECT id, scope, target, reason, created_at, session_id FROM dirty_flags WHERE resolved_at IS NULL ORDER BY created_at DESC").all();
}
// === P1: sessions helpers ===
function startSession(db, id, agentName) {
    db.prepare("INSERT OR REPLACE INTO sessions (id, agent_name, started_at, status, dirty) VALUES (?, ?, ?, 'active', 0)").run(id, agentName ?? null, new Date().toISOString());
}
function endSession(db, id, status, taskSummary) {
    db.prepare("UPDATE sessions SET ended_at = ?, status = ?, task_summary = ? WHERE id = ?").run(new Date().toISOString(), status ?? 'completed', taskSummary ?? null, id);
}
function getActiveSession(db) {
    const row = db.prepare("SELECT id, agent_name, started_at FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get();
    return row ?? null;
}
// === P1: update_log helpers ===
function insertUpdateLog(db, action, summary, sessionId, affectedCards, success, error) {
    db.prepare("INSERT INTO update_log (action, summary, session_id, created_at, affected_cards, affected_paths, success, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(action, summary ?? null, sessionId ?? null, new Date().toISOString(), affectedCards ? JSON.stringify(affectedCards) : null, null, success !== false ? 1 : 0, error ?? null);
}
function getRecentUpdateLogs(db, limit = 10) {
    return db.prepare("SELECT action, summary, created_at, success FROM update_log ORDER BY created_at DESC LIMIT ?").all(limit);
}
// === v0.6.3: Inferred edge CRUD ===
function deleteInferredEdges(db) {
    return db.prepare("DELETE FROM edges WHERE source = 'inferred'").run().changes;
}
function getInferredEdges(db) {
    return db.prepare("SELECT * FROM edges WHERE source = 'inferred' ORDER BY confidence DESC").all();
}
function getEdgesForCard(db, cardId, source) {
    let query = "SELECT * FROM edges WHERE (from_id = ? OR to_id = ?)";
    const params = [cardId, cardId];
    if (source) {
        query += " AND source = ?";
        params.push(source);
    }
    query += " ORDER BY confidence DESC";
    return db.prepare(query).all(...params);
}
function updateEdgeSource(db, edgeIds, newSource, newConfidence) {
    if (edgeIds.length === 0)
        return 0;
    const placeholders = edgeIds.map(() => '?').join(',');
    return db.prepare(`UPDATE edges SET source = ?, confidence = ?, updated_at = ? WHERE id IN (${placeholders})`).run(newSource, newConfidence, new Date().toISOString(), ...edgeIds).changes;
}
function deleteEdgesByIds(db, edgeIds) {
    if (edgeIds.length === 0)
        return 0;
    const placeholders = edgeIds.map(() => '?').join(',');
    return db.prepare(`DELETE FROM edges WHERE id IN (${placeholders})`).run(...edgeIds).changes;
}
function getOrphanEdges(db) {
    return db.prepare(`
    SELECT e.* FROM edges e
    LEFT JOIN cards c1 ON e.from_id = c1.id
    LEFT JOIN cards c2 ON e.to_id = c2.id
    WHERE c1.id IS NULL OR c2.id IS NULL
  `).all();
}
//# sourceMappingURL=db.js.map