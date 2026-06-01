import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  createSchema,
  upsertCard,
  insertEdge,
  insertAlias,
  insertTag,
  insertPath,
  getCardHash,
  clearAllTables,
  insertDirtyFlag,
  getUnresolvedDirtyFlags,
  resolveDirtyFlags,
  startSession,
  endSession,
  getActiveSession,
  insertUpdateLog,
  getRecentUpdateLogs,
} from './db';
import type { CardRow, EdgeRow } from '../types';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function makeCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 'card.1',
    type: 'feature',
    title: 'Test Card',
    status: 'active',
    priority: 'high',
    file_path: '/test/card.1.md',
    summary: 'A test card',
    schema_version: '0.3',
    card_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_verified_at: null,
    file_hash: 'abc123',
    frontmatter_hash: 'def456',
    body_hash: 'ghi789',
    token_count: 100,
    section_count: 3,
    is_deleted: 0,
    is_candidate: 0,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<EdgeRow> = {}): EdgeRow {
  return {
    from_id: 'card.1',
    to_id: 'card.2',
    type: 'depends_on',
    source: 'explicit',
    confidence: 1.0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('createSchema', () => {
  it('creates all 10 tables without error', () => {
    const db = createInMemoryDb();
    try {
      assert.doesNotThrow(() => {
        createSchema(db);
      });
    } finally {
      db.close();
    }
  });

  it('is idempotent (can be called multiple times)', () => {
    const db = createInMemoryDb();
    try {
      createSchema(db);
      assert.doesNotThrow(() => {
        createSchema(db);
      });
    } finally {
      db.close();
    }
  });
});

describe('upsertCard', () => {
  it('inserts a card', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const card = makeCard();
      upsertCard(db, card);
      const row = db.prepare('SELECT * FROM cards WHERE id = ?').get('card.1') as CardRow;
      assert.ok(row);
      assert.strictEqual(row.id, 'card.1');
      assert.strictEqual(row.title, 'Test Card');
      assert.strictEqual(row.type, 'feature');
    } finally {
      db.close();
    }
  });

  it('updates an existing card (REPLACE)', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const card = makeCard();
      upsertCard(db, card);

      const updated = makeCard({ title: 'Updated Card', token_count: 200 });
      upsertCard(db, updated);

      const row = db.prepare('SELECT * FROM cards WHERE id = ?').get('card.1') as CardRow;
      assert.strictEqual(row.title, 'Updated Card');
      assert.strictEqual(row.token_count, 200);

      // Verify only one row exists
      const count = db.prepare('SELECT COUNT(*) as cnt FROM cards').get() as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    } finally {
      db.close();
    }
  });
});

describe('getCardHash', () => {
  it('returns null for unknown path', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const result = getCardHash(db, '/nonexistent/card.md');
      assert.strictEqual(result, null);
    } finally {
      db.close();
    }
  });

  it('returns hash values for a known path', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const card = makeCard({ file_path: '/test/known.md', file_hash: 'aaa', frontmatter_hash: 'bbb', body_hash: 'ccc' });
      upsertCard(db, card);

      const result = getCardHash(db, '/test/known.md');
      assert.ok(result);
      assert.strictEqual(result.file_hash, 'aaa');
      assert.strictEqual(result.frontmatter_hash, 'bbb');
      assert.strictEqual(result.body_hash, 'ccc');
    } finally {
      db.close();
    }
  });
});

describe('insertEdge', () => {
  it('inserts an edge', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const edge = makeEdge();
      insertEdge(db, edge);
      const row = db.prepare('SELECT * FROM edges WHERE from_id = ?').get('card.1') as EdgeRow;
      assert.ok(row);
      assert.strictEqual(row.type, 'depends_on');
      assert.strictEqual(row.to_id, 'card.2');
    } finally {
      db.close();
    }
  });

  it('ignores duplicate edge (UNIQUE constraint)', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const edge = makeEdge();
      insertEdge(db, edge);
      assert.doesNotThrow(() => {
        insertEdge(db, edge);
      });
      const count = db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    } finally {
      db.close();
    }
  });
});

describe('insertAlias', () => {
  it('inserts an alias', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertAlias(db, 'card.1', 'Main Entry');
      const row = db.prepare('SELECT * FROM aliases WHERE card_id = ?').get('card.1') as { alias: string; normalized_alias: string };
      assert.ok(row);
      assert.strictEqual(row.alias, 'Main Entry');
      assert.strictEqual(row.normalized_alias, 'main entry');
    } finally {
      db.close();
    }
  });

  it('ignores duplicate alias', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertAlias(db, 'card.1', 'Main');
      insertAlias(db, 'card.1', 'Main');
      const count = db.prepare('SELECT COUNT(*) as cnt FROM aliases').get() as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    } finally {
      db.close();
    }
  });

  it('normalizes alias to lowercase', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertAlias(db, 'card.1', 'UPPERCASE Alias');
      const row = db.prepare('SELECT normalized_alias FROM aliases WHERE card_id = ?').get('card.1') as { normalized_alias: string };
      assert.strictEqual(row.normalized_alias, 'uppercase alias');
    } finally {
      db.close();
    }
  });
});

describe('insertTag', () => {
  it('inserts a tag', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertTag(db, 'card.1', 'frontend');
      const row = db.prepare('SELECT * FROM tags WHERE card_id = ?').get('card.1') as { tag: string; normalized_tag: string };
      assert.ok(row);
      assert.strictEqual(row.tag, 'frontend');
      assert.strictEqual(row.normalized_tag, 'frontend');
    } finally {
      db.close();
    }
  });

  it('ignores duplicate tag', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertTag(db, 'card.1', 'bug');
      insertTag(db, 'card.1', 'bug');
      const count = db.prepare('SELECT COUNT(*) as cnt FROM tags').get() as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    } finally {
      db.close();
    }
  });
});

describe('insertPath', () => {
  it('inserts a path relation', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertPath(db, 'card.1', '/src/index.ts', 'source_file');
      const row = db.prepare('SELECT * FROM paths WHERE card_id = ?').get('card.1') as { path: string; relation: string };
      assert.ok(row);
      assert.strictEqual(row.path, '/src/index.ts');
      assert.strictEqual(row.relation, 'source_file');
    } finally {
      db.close();
    }
  });

  it('ignores duplicate path', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertPath(db, 'card.1', '/src/main.ts', 'source_file');
      insertPath(db, 'card.1', '/src/main.ts', 'source_file');
      const count = db.prepare('SELECT COUNT(*) as cnt FROM paths').get() as { cnt: number };
      assert.strictEqual(count.cnt, 1);
    } finally {
      db.close();
    }
  });
});

describe('clearAllTables', () => {
  it('clears all data from all tables', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      upsertCard(db, makeCard());
      insertEdge(db, makeEdge());
      insertDirtyFlag(db, 'card', 'card.1', 'test dirtiness');

      clearAllTables(db);

      const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards').get() as { cnt: number };
      const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number };
      const dirtyCount = db.prepare('SELECT COUNT(*) as cnt FROM dirty_flags').get() as { cnt: number };

      assert.strictEqual(cardCount.cnt, 0);
      assert.strictEqual(edgeCount.cnt, 0);
      assert.strictEqual(dirtyCount.cnt, 0);
    } finally {
      db.close();
    }
  });
});

describe('dirty_flags', () => {
  it('insertDirtyFlag inserts a flag and getUnresolvedDirtyFlags returns it', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertDirtyFlag(db, 'card', 'card.1', 'content changed');
      const flags = getUnresolvedDirtyFlags(db);
      assert.strictEqual(flags.length, 1);
      assert.strictEqual(flags[0].scope, 'card');
      assert.strictEqual(flags[0].target, 'card.1');
      assert.strictEqual(flags[0].reason, 'content changed');
    } finally {
      db.close();
    }
  });

  it('resolveDirtyFlags resolves by scope and target', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertDirtyFlag(db, 'card', 'card.1', 'reason1');
      insertDirtyFlag(db, 'card', 'card.2', 'reason2');

      const resolved = resolveDirtyFlags(db, 'card', 'card.1');
      assert.strictEqual(resolved, 1);

      const remaining = getUnresolvedDirtyFlags(db);
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].target, 'card.2');
    } finally {
      db.close();
    }
  });

  it('resolveDirtyFlags without scope resolves all', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertDirtyFlag(db, 'card', 'card.1', 'reason1');
      insertDirtyFlag(db, 'card', 'card.2', 'reason2');

      const resolved = resolveDirtyFlags(db);
      assert.strictEqual(resolved, 2);

      const remaining = getUnresolvedDirtyFlags(db);
      assert.strictEqual(remaining.length, 0);
    } finally {
      db.close();
    }
  });
});

describe('sessions', () => {
  it('startSession, getActiveSession, endSession full lifecycle', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const sessionId = 'session-001';
      startSession(db, sessionId, 'test-agent');

      const active = getActiveSession(db);
      assert.ok(active);
      assert.strictEqual(active.id, sessionId);
      assert.strictEqual(active.agent_name, 'test-agent');

      endSession(db, sessionId, 'completed', 'Finished testing');

      const afterEnd = getActiveSession(db);
      assert.strictEqual(afterEnd, null);
    } finally {
      db.close();
    }
  });

  it('getActiveSession returns null when no active sessions', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      const active = getActiveSession(db);
      assert.strictEqual(active, null);
    } finally {
      db.close();
    }
  });

  it('getActiveSession returns latest when multiple started', async () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      startSession(db, 'session-001');
      // Small delay to ensure different started_at timestamps
      await new Promise(resolve => setTimeout(resolve, 5));
      startSession(db, 'session-002');

      const active = getActiveSession(db);
      assert.ok(active);
      assert.strictEqual(active.id, 'session-002');
    } finally {
      db.close();
    }
  });
});

describe('update_log', () => {
  it('insertUpdateLog and getRecentUpdateLogs', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertUpdateLog(db, 'rebuild', 'Rebuilt indexes', undefined, undefined, true);

      const logs = getRecentUpdateLogs(db);
      assert.ok(logs.length >= 1);
      const latest = logs[0];
      assert.strictEqual(latest.action, 'rebuild');
      assert.strictEqual(latest.summary, 'Rebuilt indexes');
      assert.strictEqual(latest.success, 1);
    } finally {
      db.close();
    }
  });

  it('getRecentUpdateLogs respects limit', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertUpdateLog(db, 'action1');
      insertUpdateLog(db, 'action2');
      insertUpdateLog(db, 'action3');

      const logs = getRecentUpdateLogs(db, 2);
      assert.strictEqual(logs.length, 2);
    } finally {
      db.close();
    }
  });

  it('insertUpdateLog with sessionId and affectedCards', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertUpdateLog(db, 'update', 'Updated card', 'session-1', ['card.1', 'card.2'], true);

      const logs = getRecentUpdateLogs(db, 1);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].action, 'update');
      assert.strictEqual(logs[0].summary, 'Updated card');
      assert.strictEqual(logs[0].success, 1);
    } finally {
      db.close();
    }
  });

  it('insertUpdateLog records failure', () => {
    const db = createInMemoryDb();
    createSchema(db);
    try {
      insertUpdateLog(db, 'rebuild', 'Rebuild failed', undefined, undefined, false, 'Corrupt data');

      const logs = getRecentUpdateLogs(db, 1);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].action, 'rebuild');
      assert.strictEqual(logs[0].success, 0);
    } finally {
      db.close();
    }
  });
});
