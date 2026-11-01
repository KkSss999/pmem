'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// The memory worker makes exactly one structured model call per batch. This test
// drives the real pipeline with a fake model, so it proves batching and call
// counts without any network or agent session.

function payloadFor(kind, envelope) {
  switch (kind) {
    case 'l1-extract':
      return {
        memories: envelope.allowedMessageIds.map((id) => ({
          content: `memory ${id}`,
          abstraction: 'stub abstraction',
          cues: [id],
          sourceIds: [id],
          relatedSpaceIds: [],
        })),
      };
    case 'l1-maintenance':
      return {
        decisions: envelope.cases.map((entry) => ({ memoryId: entry.memory.id, action: 'keep' })),
      };
    case 'l2-synthesize': {
      const results = envelope.allowedL1Ids.map((id) => ({
        action: 'create',
        title: `title ${id}`,
        summary: 'stub summary',
        body: 'stub body',
        l1Ids: [id],
      }));
      return { results, uncoveredL1Ids: [] };
    }
    case 'l3-keywords':
      return {
        keywords: envelope.allowedL2Ids.map((id) => ({
          term: `kw${id.replaceAll('-', '').slice(0, 10)}`,
          aliases: [],
          kind: 'topic',
          baseWeight: 3,
          l2Ids: [id],
        })),
      };
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-batch-'));
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
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  const { assembleL1 } = require(path.join(root, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(root, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(root, 'dist/server/l2'));
  const { assembleL3 } = require(path.join(root, 'dist/server/l3'));
  const { assembleMemoryStream } = require(path.join(root, 'dist/server/stream'));
  const { MemoryStreamPipeline } = require(path.join(root, 'dist/agent/stream-pipeline'));
  const { MemoryStreamWorker } = require(path.join(root, 'dist/agent/memory-worker'));

  const db = OwnedDatabase.create(path.join(root, 'memory.sqlite'));
  t.after(() => db.close());
  const access = {
    readableSpaceIds: ['personal'],
    writableSpaceIds: ['personal'],
    canManageSpaces: true,
  };
  const memory = assembleMemory(db);
  const l1 = assembleL1(db);
  const maintenance = assembleL1Maintenance(db);
  const l2 = assembleL2(db);
  const l3 = assembleL3(db);
  const store = assembleMemoryStream(db);
  const workspaceId = 'batch';
  const pipeline = new MemoryStreamPipeline({
    queue: store.queue,
    workspaceId,
    scopeId: 'personal',
    access,
    l1,
    maintenance,
    l2,
    l3,
  });
  const calls = [];
  const worker = new MemoryStreamWorker({
    queue: store.queue,
    handler: pipeline,
    workspaceId,
    scopeId: 'personal',
    model: {
      async run(kind, envelope) {
        calls.push({ kind, items: envelope.itemIds.length });
        return payloadFor(kind, envelope);
      },
    },
  });
  return { root, db, access, memory, l1, l2, l3, store, worker, calls, workspaceId };
}

test('one model call covers a batch of items of the same kind', async (t) => {
  const f = fixture(t);
  const turns = 12;
  for (let index = 0; index < turns; index++) {
    const message = f.memory.appendL0(
      {
        spaceId: 'personal',
        role: index % 2 ? 'assistant' : 'user',
        content: `turn ${index} about topic ${index}`,
      },
      f.access
    ).message;
    f.store.queue.enqueue({
      workspaceId: f.workspaceId,
      scopeId: 'personal',
      kind: 'l1-extract',
      subjectId: message.id,
      sourceHash: f.l1.streamSourceHash(message.id, f.access),
    });
  }
  const processed = await f.worker.runUntilIdle(500);
  assert.ok(processed > 0);

  const byKind = f.calls.reduce((totals, call) => {
    totals[call.kind] = (totals[call.kind] ?? 0) + 1;
    return totals;
  }, {});
  assert.ok(
    byKind['l1-extract'] <= 3,
    `12 turns must batch into at most 3 l1-extract calls, got ${byKind['l1-extract']}`
  );
  assert.ok(
    f.calls.length <= turns,
    `one structured call per batch must not exceed the turn count, got ${f.calls.length}`
  );
  // Every call carries a batch and no item stays pending.
  for (const call of f.calls) assert.ok(call.items >= 1);
  for (const kind of ['l1-extract', 'l1-maintenance', 'l2-synthesize', 'l3-keywords'])
    assert.equal(f.store.queue.pending(f.workspaceId, 'personal', kind, 100).length, 0);

  const memories = f.l1.recall(
    { query: 'topic 3', anchoredSpaceIds: ['personal'], limit: 10 },
    f.access
  );
  assert.ok(memories.length >= 1);
  assert.ok(
    f.l2.listMemories({ ownerSpaceId: 'personal' }, f.access).length >= 1,
    'L2 must be synthesized from the committed L1 memories'
  );
});

test('every strict schema lists all of its properties as required', () => {
  const { MEMORY_STREAM_PROMPTS } = require(path.join(__dirname, '..', 'dist/agent/memory-model'));
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object' && schema.properties) {
      const required = schema.required ?? [];
      for (const key of Object.keys(schema.properties)) {
        assert.ok(required.includes(key), `${where}.${key} must be required in strict mode`);
        check(schema.properties[key], `${where}.${key}`);
      }
      assert.equal(schema.additionalProperties, false, `${where} must forbid extra properties`);
    }
    if (schema.type === 'array' && schema.items) check(schema.items, `${where}[]`);
  };
  for (const [kind, prompt] of Object.entries(MEMORY_STREAM_PROMPTS)) check(prompt.schema, kind);
});

test('the model receives data only, with a strict schema', async (t) => {
  const f = fixture(t);
  const { OpenAIMemoryStreamModel } = require(path.join(f.root, 'dist/agent/memory-model'));
  let captured;
  const model = new OpenAIMemoryStreamModel({
    apiKey: 'test',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    fetch: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"memories":[]}' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });
  const payload = await model.run('l1-extract', {
    itemIds: ['item-1'],
    kind: 'l1-extract',
    rules: ['only supplied ids'],
    outputTool: 'memory_stream_submit',
    space: { id: 'personal', name: 'Personal' },
    messages: [{ id: 'm1', content: 'hello' }],
    allowedMessageIds: ['m1'],
  });
  assert.deepEqual(payload, { memories: [] });
  assert.equal(captured.messages.length, 2, 'one system and one user message');
  assert.ok(captured.messages[0].content.includes('Extract useful atomic memories'));
  const data = JSON.parse(captured.messages[1].content);
  assert.equal(data.outputTool, undefined, 'routing fields stay out of the prompt');
  assert.equal(data.rules, undefined);
  assert.equal(data.itemIds, undefined);
  assert.deepEqual(data.allowedMessageIds, ['m1']);
  assert.equal(captured.response_format.type, 'json_schema');
  assert.equal(captured.response_format.json_schema.strict, true);
  assert.equal(captured.model, 'test-model');
});

test('coverage synthesis only queues L1 memories that no L2 cites', async (t) => {
  const f = fixture(t);
  const memory = f.memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'I prefer tea in the morning.' },
    f.access
  ).message;
  f.store.queue.enqueue({
    workspaceId: f.workspaceId,
    scopeId: 'personal',
    kind: 'l1-extract',
    subjectId: memory.id,
    sourceHash: f.l1.streamSourceHash(memory.id, f.access),
  });
  await f.worker.runUntilIdle(100);
  const l1Ids = f.l1.uncoveredMemoryIds(['personal'], f.access, 10);
  assert.equal(l1Ids.length, 0, 'the normal L2 pass must already cover a single change');

  // Simulate a change the model left uncovered: a second L1 with no L2.
  const uncovered = f.memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'I also like coffee.' },
    f.access
  ).message;
  f.store.queue.enqueue({
    workspaceId: f.workspaceId,
    scopeId: 'personal',
    kind: 'l1-extract',
    subjectId: uncovered.id,
    sourceHash: f.l1.streamSourceHash(uncovered.id, f.access),
  });
  await f.worker.runUntilIdle(100);
  const remaining = f.l1.uncoveredMemoryIds(['personal'], f.access, 10);
  // L1 items always get an L2 in this fake model, so nothing is left to sweep.
  assert.equal(remaining.length, 0);
});

test('maintenance re-queues cases that stayed pending after apply', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-handler-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(root, 'dist'), { recursive: true });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { L1MaintenanceStreamHandler } = require(
    path.join(root, 'dist/agent/l1-maintenance-stream-handler')
  );
  const access = {
    readableSpaceIds: ['personal'],
    writableSpaceIds: ['personal'],
    canManageSpaces: true,
  };
  const committed = [];
  const deferred = [];
  const service = {
    prepareStream: () => ({
      memoryIds: ['memory-1'],
      token: 'token',
      cases: [
        {
          memory: { id: 'memory-1', content: 'a', abstraction: 'a', cues: [], spaceId: 'personal' },
          candidates: [
            {
              id: 'memory-2',
              content: 'b',
              abstraction: 'b',
              cues: [],
              spaceId: 'personal',
            },
          ],
        },
      ],
      modelCases: [{ memory: { id: 'memory-1' }, candidates: [] }],
      now: '2026-11-01T00:00:00.000Z',
    }),
    applyStream: () => ['memory-1'],
    pendingIds: () => ['memory-1'],
  };
  const handler = new L1MaintenanceStreamHandler(
    service,
    access,
    (ids) => committed.push(...ids),
    (ids) => deferred.push(...ids)
  );
  const prepared = handler.prepare([
    {
      id: 'item-1',
      workspaceId: 'ws',
      scopeId: 'personal',
      kind: 'l1-maintenance',
      subjectId: 'memory-1',
      sourceHash: 'hash',
      state: 'running',
      attempt: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ]);
  assert.ok(prepared);
  prepared.apply({ decisions: [{ memoryId: 'memory-1', action: 'keep' }] });
  assert.deepEqual(committed, ['memory-1']);
  assert.deepEqual(deferred, ['memory-1']);
});

test('memory calls disable provider thinking', async (t) => {
  const f = fixture(t);
  const { OpenAIMemoryStreamModel } = require(path.join(f.root, 'dist/agent/memory-model'));
  let body;
  const model = new OpenAIMemoryStreamModel({
    apiKey: 'test',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"memories":[]}' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });
  await model.run('l1-extract', { messages: [] });
  assert.equal(body.reasoning_effort, 'none');
  const thinking = new OpenAIMemoryStreamModel({
    apiKey: 'test',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    reasoningEffort: 'default',
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"memories":[]}' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });
  await thinking.run('l1-extract', { messages: [] });
  assert.equal(body.reasoning_effort, undefined);
});
