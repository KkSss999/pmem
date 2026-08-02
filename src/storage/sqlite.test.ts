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
      created_at: new Date().toISOString(),
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
      created_at: new Date().toISOString(),
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
