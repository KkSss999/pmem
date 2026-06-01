"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const db_1 = require("./db");
function createInMemoryDb() {
    const db = new better_sqlite3_1.default(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
}
function makeCard(overrides = {}) {
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
function makeEdge(overrides = {}) {
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
(0, node_test_1.describe)('createSchema', () => {
    (0, node_test_1.it)('creates all 10 tables without error', () => {
        const db = createInMemoryDb();
        try {
            node_assert_1.default.doesNotThrow(() => {
                (0, db_1.createSchema)(db);
            });
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('is idempotent (can be called multiple times)', () => {
        const db = createInMemoryDb();
        try {
            (0, db_1.createSchema)(db);
            node_assert_1.default.doesNotThrow(() => {
                (0, db_1.createSchema)(db);
            });
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('upsertCard', () => {
    (0, node_test_1.it)('inserts a card', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const card = makeCard();
            (0, db_1.upsertCard)(db, card);
            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get('card.1');
            node_assert_1.default.ok(row);
            node_assert_1.default.strictEqual(row.id, 'card.1');
            node_assert_1.default.strictEqual(row.title, 'Test Card');
            node_assert_1.default.strictEqual(row.type, 'feature');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('updates an existing card (REPLACE)', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const card = makeCard();
            (0, db_1.upsertCard)(db, card);
            const updated = makeCard({ title: 'Updated Card', token_count: 200 });
            (0, db_1.upsertCard)(db, updated);
            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get('card.1');
            node_assert_1.default.strictEqual(row.title, 'Updated Card');
            node_assert_1.default.strictEqual(row.token_count, 200);
            // Verify only one row exists
            const count = db.prepare('SELECT COUNT(*) as cnt FROM cards').get();
            node_assert_1.default.strictEqual(count.cnt, 1);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('getCardHash', () => {
    (0, node_test_1.it)('returns null for unknown path', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const result = (0, db_1.getCardHash)(db, '/nonexistent/card.md');
            node_assert_1.default.strictEqual(result, null);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('returns hash values for a known path', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const card = makeCard({ file_path: '/test/known.md', file_hash: 'aaa', frontmatter_hash: 'bbb', body_hash: 'ccc' });
            (0, db_1.upsertCard)(db, card);
            const result = (0, db_1.getCardHash)(db, '/test/known.md');
            node_assert_1.default.ok(result);
            node_assert_1.default.strictEqual(result.file_hash, 'aaa');
            node_assert_1.default.strictEqual(result.frontmatter_hash, 'bbb');
            node_assert_1.default.strictEqual(result.body_hash, 'ccc');
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('insertEdge', () => {
    (0, node_test_1.it)('inserts an edge', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const edge = makeEdge();
            (0, db_1.insertEdge)(db, edge);
            const row = db.prepare('SELECT * FROM edges WHERE from_id = ?').get('card.1');
            node_assert_1.default.ok(row);
            node_assert_1.default.strictEqual(row.type, 'depends_on');
            node_assert_1.default.strictEqual(row.to_id, 'card.2');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('ignores duplicate edge (UNIQUE constraint)', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const edge = makeEdge();
            (0, db_1.insertEdge)(db, edge);
            node_assert_1.default.doesNotThrow(() => {
                (0, db_1.insertEdge)(db, edge);
            });
            const count = db.prepare('SELECT COUNT(*) as cnt FROM edges').get();
            node_assert_1.default.strictEqual(count.cnt, 1);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('insertAlias', () => {
    (0, node_test_1.it)('inserts an alias', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertAlias)(db, 'card.1', 'Main Entry');
            const row = db.prepare('SELECT * FROM aliases WHERE card_id = ?').get('card.1');
            node_assert_1.default.ok(row);
            node_assert_1.default.strictEqual(row.alias, 'Main Entry');
            node_assert_1.default.strictEqual(row.normalized_alias, 'main entry');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('ignores duplicate alias', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertAlias)(db, 'card.1', 'Main');
            (0, db_1.insertAlias)(db, 'card.1', 'Main');
            const count = db.prepare('SELECT COUNT(*) as cnt FROM aliases').get();
            node_assert_1.default.strictEqual(count.cnt, 1);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('normalizes alias to lowercase', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertAlias)(db, 'card.1', 'UPPERCASE Alias');
            const row = db.prepare('SELECT normalized_alias FROM aliases WHERE card_id = ?').get('card.1');
            node_assert_1.default.strictEqual(row.normalized_alias, 'uppercase alias');
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('insertTag', () => {
    (0, node_test_1.it)('inserts a tag', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertTag)(db, 'card.1', 'frontend');
            const row = db.prepare('SELECT * FROM tags WHERE card_id = ?').get('card.1');
            node_assert_1.default.ok(row);
            node_assert_1.default.strictEqual(row.tag, 'frontend');
            node_assert_1.default.strictEqual(row.normalized_tag, 'frontend');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('ignores duplicate tag', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertTag)(db, 'card.1', 'bug');
            (0, db_1.insertTag)(db, 'card.1', 'bug');
            const count = db.prepare('SELECT COUNT(*) as cnt FROM tags').get();
            node_assert_1.default.strictEqual(count.cnt, 1);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('insertPath', () => {
    (0, node_test_1.it)('inserts a path relation', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertPath)(db, 'card.1', '/src/index.ts', 'source_file');
            const row = db.prepare('SELECT * FROM paths WHERE card_id = ?').get('card.1');
            node_assert_1.default.ok(row);
            node_assert_1.default.strictEqual(row.path, '/src/index.ts');
            node_assert_1.default.strictEqual(row.relation, 'source_file');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('ignores duplicate path', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertPath)(db, 'card.1', '/src/main.ts', 'source_file');
            (0, db_1.insertPath)(db, 'card.1', '/src/main.ts', 'source_file');
            const count = db.prepare('SELECT COUNT(*) as cnt FROM paths').get();
            node_assert_1.default.strictEqual(count.cnt, 1);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('clearAllTables', () => {
    (0, node_test_1.it)('clears all data from all tables', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.upsertCard)(db, makeCard());
            (0, db_1.insertEdge)(db, makeEdge());
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.1', 'test dirtiness');
            (0, db_1.clearAllTables)(db);
            const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards').get();
            const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get();
            const dirtyCount = db.prepare('SELECT COUNT(*) as cnt FROM dirty_flags').get();
            node_assert_1.default.strictEqual(cardCount.cnt, 0);
            node_assert_1.default.strictEqual(edgeCount.cnt, 0);
            node_assert_1.default.strictEqual(dirtyCount.cnt, 0);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('dirty_flags', () => {
    (0, node_test_1.it)('insertDirtyFlag inserts a flag and getUnresolvedDirtyFlags returns it', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.1', 'content changed');
            const flags = (0, db_1.getUnresolvedDirtyFlags)(db);
            node_assert_1.default.strictEqual(flags.length, 1);
            node_assert_1.default.strictEqual(flags[0].scope, 'card');
            node_assert_1.default.strictEqual(flags[0].target, 'card.1');
            node_assert_1.default.strictEqual(flags[0].reason, 'content changed');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('resolveDirtyFlags resolves by scope and target', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.1', 'reason1');
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.2', 'reason2');
            const resolved = (0, db_1.resolveDirtyFlags)(db, 'card', 'card.1');
            node_assert_1.default.strictEqual(resolved, 1);
            const remaining = (0, db_1.getUnresolvedDirtyFlags)(db);
            node_assert_1.default.strictEqual(remaining.length, 1);
            node_assert_1.default.strictEqual(remaining[0].target, 'card.2');
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('resolveDirtyFlags without scope resolves all', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.1', 'reason1');
            (0, db_1.insertDirtyFlag)(db, 'card', 'card.2', 'reason2');
            const resolved = (0, db_1.resolveDirtyFlags)(db);
            node_assert_1.default.strictEqual(resolved, 2);
            const remaining = (0, db_1.getUnresolvedDirtyFlags)(db);
            node_assert_1.default.strictEqual(remaining.length, 0);
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('sessions', () => {
    (0, node_test_1.it)('startSession, getActiveSession, endSession full lifecycle', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const sessionId = 'session-001';
            (0, db_1.startSession)(db, sessionId, 'test-agent');
            const active = (0, db_1.getActiveSession)(db);
            node_assert_1.default.ok(active);
            node_assert_1.default.strictEqual(active.id, sessionId);
            node_assert_1.default.strictEqual(active.agent_name, 'test-agent');
            (0, db_1.endSession)(db, sessionId, 'completed', 'Finished testing');
            const afterEnd = (0, db_1.getActiveSession)(db);
            node_assert_1.default.strictEqual(afterEnd, null);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('getActiveSession returns null when no active sessions', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            const active = (0, db_1.getActiveSession)(db);
            node_assert_1.default.strictEqual(active, null);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('getActiveSession returns latest when multiple started', async () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.startSession)(db, 'session-001');
            // Small delay to ensure different started_at timestamps
            await new Promise(resolve => setTimeout(resolve, 5));
            (0, db_1.startSession)(db, 'session-002');
            const active = (0, db_1.getActiveSession)(db);
            node_assert_1.default.ok(active);
            node_assert_1.default.strictEqual(active.id, 'session-002');
        }
        finally {
            db.close();
        }
    });
});
(0, node_test_1.describe)('update_log', () => {
    (0, node_test_1.it)('insertUpdateLog and getRecentUpdateLogs', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertUpdateLog)(db, 'rebuild', 'Rebuilt indexes', undefined, undefined, true);
            const logs = (0, db_1.getRecentUpdateLogs)(db);
            node_assert_1.default.ok(logs.length >= 1);
            const latest = logs[0];
            node_assert_1.default.strictEqual(latest.action, 'rebuild');
            node_assert_1.default.strictEqual(latest.summary, 'Rebuilt indexes');
            node_assert_1.default.strictEqual(latest.success, 1);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('getRecentUpdateLogs respects limit', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertUpdateLog)(db, 'action1');
            (0, db_1.insertUpdateLog)(db, 'action2');
            (0, db_1.insertUpdateLog)(db, 'action3');
            const logs = (0, db_1.getRecentUpdateLogs)(db, 2);
            node_assert_1.default.strictEqual(logs.length, 2);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('insertUpdateLog with sessionId and affectedCards', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertUpdateLog)(db, 'update', 'Updated card', 'session-1', ['card.1', 'card.2'], true);
            const logs = (0, db_1.getRecentUpdateLogs)(db, 1);
            node_assert_1.default.strictEqual(logs.length, 1);
            node_assert_1.default.strictEqual(logs[0].action, 'update');
            node_assert_1.default.strictEqual(logs[0].summary, 'Updated card');
            node_assert_1.default.strictEqual(logs[0].success, 1);
        }
        finally {
            db.close();
        }
    });
    (0, node_test_1.it)('insertUpdateLog records failure', () => {
        const db = createInMemoryDb();
        (0, db_1.createSchema)(db);
        try {
            (0, db_1.insertUpdateLog)(db, 'rebuild', 'Rebuild failed', undefined, undefined, false, 'Corrupt data');
            const logs = (0, db_1.getRecentUpdateLogs)(db, 1);
            node_assert_1.default.strictEqual(logs.length, 1);
            node_assert_1.default.strictEqual(logs[0].action, 'rebuild');
            node_assert_1.default.strictEqual(logs[0].success, 0);
        }
        finally {
            db.close();
        }
    });
});
//# sourceMappingURL=db.test.js.map