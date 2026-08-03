import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EMPTY_SCHEMA_REGISTRY, SqliteMemoryBackend } from './sqlite';
import type { MemoryEvent, MemoryRecord } from '../runtime/model';

function makeBackend(): { root: string; backend: SqliteMemoryBackend } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-sqlite-backend-'));
  const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
  backend.open({ root, schema: EMPTY_SCHEMA_REGISTRY });
  return { root, backend };
}

function record(id: string, title: string): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    schema: { id: 'memory', version: '1.0.0' },
    data: { title, type: 'memory', summary: `${title} summary` },
    scope: 'project',
    provenance: { source: 'test', source_id: id },
    created_at: now,
    updated_at: now,
  };
}

test('SQLite backend opens, writes, reads, structured-queries, and searches', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction({ principal: 'test' });
    tx.putRecord(record('memory.alpha', 'Alpha memory'));
    tx.commit();

    assert.equal(backend.getRecord('memory.alpha')?.data.title, 'Alpha memory');
    assert.equal(backend.query({ schema: { id: 'memory', version: '1.0.0' } }).records.length, 1);
    assert.equal(backend.search({ text: 'Alpha' }).hits[0]?.record_id, 'memory.alpha');
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite backend exposes a bounded, deterministic event history port', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction();
    tx.appendEvent({
      id: 'history-one', type: 'commit', scope: 'project', occurred_at: '2026-08-03T10:00:00.000Z',
      recorded_at: '2026-08-03T10:00:00.000Z', record_id: 'memory.database', payload: { summary: 'mysql' },
    });
    tx.appendEvent({
      id: 'history-two', type: 'commit', scope: 'project', occurred_at: '2026-08-03T11:00:00.000Z',
      recorded_at: '2026-08-03T11:00:00.000Z', payload: { target_id: 'memory.database', changes: [{ path: 'db', before: 'mysql', after: 'postgres' }] },
    });
    tx.appendEvent({
      id: 'history-three', type: 'commit', scope: 'project', occurred_at: '2026-08-03T12:00:00.000Z',
      recorded_at: '2026-08-03T12:00:00.000Z', record_id: 'memory.database', payload: { summary: 'postgres + migrated' },
    });
    tx.appendEvent({
      id: 'history-other', type: 'commit', scope: 'project', occurred_at: '2026-08-03T12:00:00.000Z',
      recorded_at: '2026-08-03T12:00:00.000Z', record_id: 'memory.other', payload: {},
    });
    tx.commit();
    const history = backend.listEvents?.({ recordId: 'memory.database', limit: 10 });
    assert.deepEqual(history?.map(event => event.id), ['1', '2', '3']);
    assert.equal(history?.[1]?.payload.target_id, 'memory.database');
    assert.deepEqual(backend.listEvents?.({ recordId: 'memory.database', limit: 2 }).map(event => event.id), ['2', '3']);
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite record-scoped history filters before the bounded global event window', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction();
    tx.appendEvent({
      id: 'target-before', type: 'commit', scope: 'project', occurred_at: '2026-08-03T10:00:00.000Z',
      recorded_at: '2026-08-03T10:00:00.000Z', record_id: 'memory.target', payload: { summary: 'target' },
    });
    for (let index = 0; index < 600; index += 1) {
      tx.appendEvent({
        id: `other-${index}`, type: 'commit', scope: 'project', occurred_at: `2026-08-03T11:${String(index % 60).padStart(2, '0')}:00.000Z`,
        recorded_at: `2026-08-03T11:${String(index % 60).padStart(2, '0')}:00.000Z`, record_id: 'memory.other', payload: {},
      });
    }
    tx.appendEvent({
      id: 'target-after', type: 'commit', scope: 'project', occurred_at: '2026-08-03T23:00:00.000Z',
      recorded_at: '2026-08-03T23:00:00.000Z', record_id: 'memory.target', payload: { summary: 'target latest' },
    });
    tx.commit();
    assert.deepEqual(backend.listEvents?.({ recordId: 'memory.target', limit: 10 }).map(event => event.record_id), ['memory.target', 'memory.target']);
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite codec persists arbitrary schema data without creating a Card row', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction();
    tx.putRecord({
      id: 'character.alice',
      schema: { id: 'character', version: '1' },
      data: { name: 'Alice', age: 20 },
      scope: { id: 'world-1', kind: 'world' },
      provenance: { source: 'test' },
      created_at: '2026-08-02T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
    });
    tx.commit();
    assert.deepEqual(backend.getRecord('character.alice')?.data, { name: 'Alice', age: 20 });
    assert.deepEqual(backend.query({ schema: { id: 'character', version: '1' }, filters: [{ field: 'age', operator: 'gte', value: 18 }] }).records.map(record => record.id), ['character.alice']);
    assert.equal((backend.database!.prepare('SELECT COUNT(*) AS count FROM cards WHERE id = ?').get('character.alice') as { count: number }).count, 0);
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite transaction rollback removes records and all atomic side effects', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction({ correlation_id: 'rollback-test' });
    tx.putRecord(record('memory.rollback', 'Rollback memory'));
    tx.putRelation({ from_id: 'memory.rollback', to_id: 'memory.target', type: 'related_to' });
    tx.upsertSearchDocument({ record_id: 'memory.rollback', text: 'rollback text' });
    const event: MemoryEvent = {
      id: 'rollback-event',
      type: 'commit',
      scope: 'project',
      occurred_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      payload: { record_id: 'memory.rollback' },
      record_id: 'memory.rollback',
    };
    tx.appendEvent(event);
    tx.rollback(new Error('injected failure'));

    assert.equal(backend.getRecord('memory.rollback'), null);
    const db = backend.database!;
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM edges WHERE from_id = ?').get('memory.rollback') as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM events WHERE memory_id = ?').get('memory.rollback') as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM memory_search WHERE record_id = ?').get('memory.rollback') as { count: number }).count, 0);
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite transaction commit persists record, event, relation, and search document atomically', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction({ correlation_id: 'commit-test' });
    tx.putRecord(record('memory.commit', 'Commit memory'));
    tx.putRelation({ from_id: 'memory.commit', to_id: 'memory.target', type: 'depends_on' });
    tx.upsertSearchDocument({ record_id: 'memory.commit', text: 'commit text' });
    tx.appendEvent({
      id: 'commit-event',
      type: 'commit',
      scope: 'project',
      occurred_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      payload: { ok: true },
      record_id: 'memory.commit',
    });
    tx.commit();

    const db = backend.database!;
    assert.equal(backend.getRecord('memory.commit')?.data.title, 'Commit memory');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM edges WHERE from_id = ?').get('memory.commit') as { count: number }).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM events WHERE memory_id = ?').get('memory.commit') as { count: number }).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM memory_search WHERE record_id = ?').get('memory.commit') as { count: number }).count, 1);
    const graph = backend.query({ relation: { from_id: 'memory.commit', type: 'depends_on' } });
    assert.deepEqual(graph.records.map(item => item.id), []);
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite graph query returns related target records through edges', () => {
  const { root, backend } = makeBackend();
  try {
    const tx = backend.beginTransaction();
    tx.putRecord(record('memory.source', 'Source'));
    tx.putRecord(record('memory.target', 'Target'));
    tx.putRelation({ from_id: 'memory.source', to_id: 'memory.target', type: 'depends_on' });
    tx.commit();
    assert.deepEqual(
      backend.query({ relation: { from_id: 'memory.source', type: 'depends_on' } }).records.map(item => item.id),
      ['memory.target'],
    );
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite semantic adapter is opt-in and never contaminates deterministic search', async () => {
  const { root, backend } = makeBackend();
  try {
    assert.equal(backend.capabilities.query.semantic, false);
    backend.setSemanticAdapter({
      search: async (text, limit) => ({
        hits: [{ record_id: `semantic:${text}`, score: 0.9, channels: ['semantic'] }].slice(0, limit),
      }),
    });
    assert.equal(backend.capabilities.query.semantic, true);
    const semantic = await backend.search({ channel: 'semantic', text: 'payment', limit: 3 });
    assert.equal(semantic.hits[0]?.record_id, 'semantic:payment');
    // The normal path remains the existing SQLite LIKE/FTS projection.
    assert.deepEqual(backend.search({ channel: 'lexical', text: 'payment', limit: 3 }).hits, []);
    backend.setSemanticAdapter(null);
    assert.equal(backend.capabilities.query.semantic, false);
    const unavailable = await backend.search({ channel: 'semantic', text: 'payment', limit: 3 });
    assert.deepEqual(unavailable.hits, []);
    assert.ok(unavailable.warnings?.[0]?.includes('adapter is not configured'));
  } finally {
    backend.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
