'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-stream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(root, 'dist'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'migrations'), path.join(root, 'migrations'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { OwnedDatabase } = require(path.join(root, 'dist/db/database'));
  const { assembleMemoryStream } = require(path.join(root, 'dist/server/stream'));
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  const { assembleL1 } = require(path.join(root, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(root, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(root, 'dist/server/l2'));
  const { assembleL3 } = require(path.join(root, 'dist/server/l3'));
  const db = OwnedDatabase.create(path.join(root, 'memory.sqlite'));
  return {
    root,
    db,
    stream: assembleMemoryStream(db),
    memory: assembleMemory(db),
    l1: assembleL1(db),
    maintenance: assembleL1Maintenance(db),
    l2: assembleL2(db),
    l3: assembleL3(db),
  };
}

test('stream queue is durable, deduplicated, serial and recoverable', (t) => {
  const f = fixture(t);
  const first = f.stream.queue.enqueue({
    workspaceId: 'pmem',
    scopeId: 'personal',
    kind: 'l1-extract',
    subjectId: 'l0-a',
    sourceHash: 'hash-a',
  });
  const duplicate = f.stream.queue.enqueue({
    workspaceId: 'pmem',
    scopeId: 'personal',
    kind: 'l1-extract',
    subjectId: 'l0-a',
    sourceHash: 'hash-a',
  });
  assert.equal(duplicate.id, first.id);
  assert.equal(first.state, 'pending');

  const next = f.stream.queue.next('pmem', 'personal');
  assert.equal(next.id, first.id);
  const claimed = f.stream.queue.claim(first.id);
  assert.equal(claimed.state, 'running');
  assert.equal(f.stream.queue.next('pmem', 'personal'), undefined);

  assert.equal(f.stream.queue.recoverRunning('pmem', 'personal'), 1);
  const recovered = f.stream.queue.find('pmem', 'personal', 'l1-extract', 'l0-a', 'hash-a');
  assert.equal(recovered.state, 'unknown');
  assert.equal(recovered.errorCode, 'INTERRUPTED');

  const retried = f.stream.queue.retry(first.id);
  assert.equal(retried.state, 'pending');
  const claimedAgain = f.stream.queue.claim(first.id);
  const done = f.stream.queue.finish(claimedAgain.id, 'done', undefined);
  assert.equal(done.state, 'done');
  f.db.close();
});

test('L0 ingest and L1 commit enqueue follow-up stream items', async (t) => {
  const f = fixture(t);
  const access = {
    readableSpaceIds: ['personal'],
    writableSpaceIds: ['personal'],
    canManageSpaces: true,
  };
  const { MemoryStreamIngest, MemoryStreamPipeline } = require(
    path.join(f.root, 'dist/agent/stream-pipeline')
  );
  const ingest = new MemoryStreamIngest(f.memory, f.l1, f.stream.queue, 'pmem', 'personal', access);
  const source = ingest.appendL0({
    spaceId: 'personal',
    role: 'user',
    content: '阿岚喜欢拿铁。',
  }).message;
  const l1Item = f.stream.queue.next('pmem', 'personal');
  assert.equal(l1Item.kind, 'l1-extract');
  const claimed = f.stream.queue.claim(l1Item.id);
  const pipeline = new MemoryStreamPipeline({
    queue: f.stream.queue,
    workspaceId: 'pmem',
    scopeId: 'personal',
    access,
    l1: f.l1,
    maintenance: f.maintenance,
    l2: f.l2,
    l3: f.l3,
  });
  const prepared = await pipeline.prepare(claimed);
  prepared.apply({
    memories: [
      {
        content: '阿岚喜欢拿铁。',
        abstraction: '偏好',
        cues: ['拿铁'],
        sourceIds: [source.id],
        relatedSpaceIds: [],
      },
    ],
  });
  f.stream.queue.finish(claimed.id, 'done', undefined);
  const queued = f.stream.queue.next('pmem', 'personal');
  assert.ok(queued);
  assert.equal(queued.kind, 'l1-maintenance');
  f.db.close();
});
