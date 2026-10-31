'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-agent-'));
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
  const { assembleL1 } = require(path.join(root, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(root, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(root, 'dist/server/l2'));
  const { AgentMemory } = require(path.join(root, 'dist/agent/memory'));
  const { createSingleUserAgentHost } = require(path.join(root, 'dist/agent/access'));
  const { createPmemMemoryPlugin } = require(path.join(root, 'dist/agent/plugin'));
  const { PmemAgentRuntime } = require(path.join(root, 'dist/agent/runtime'));
  const db = OwnedDatabase.create(path.join(root, 'memory.sqlite'));
  return {
    root,
    db,
    memoryService: require(path.join(root, 'dist/server/memory')).assembleMemory(db),
    l1: assembleL1(db),
    maintenance: assembleL1Maintenance(db),
    l2: assembleL2(db),
    AgentMemory,
    createSingleUserAgentHost,
    createPmemMemoryPlugin,
    PmemAgentRuntime,
  };
}

const personal = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const keep = (memoryId) => ({
  memoryId,
  action: 'keep',
  targetId: null,
  content: null,
  abstraction: null,
  cues: [],
});

async function makeL1(f, jobId, content) {
  const source = f.memoryService.appendL0(
    { spaceId: 'personal', role: 'user', content: `source ${jobId} ${content}` },
    personal
  ).message;
  f.l1.enqueue({ id: jobId, sourceIds: [source.id], relatedSpaceIds: [] }, personal);
  await f.l1.run(
    jobId,
    {
      extract: async () => ({
        memories: [
          {
            content,
            abstraction: '主题',
            cues: ['线索'],
            sourceIds: [source.id],
            relatedSpaceIds: [],
          },
        ],
      }),
    },
    personal
  );
  const memory = f.l1.getJobMemories(jobId, personal)[0];
  const work = f.maintenance.startBatch(
    {
      review: async ({ cases }) => ({ decisions: cases.map((item) => keep(item.memory.id)) }),
    },
    personal
  );
  if (work) await work;
  return f.l1.getMemory(memory.id, personal);
}

async function makeL2(f, l1) {
  f.l2.recordChange({ l1Id: l1.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: `job-${l1.id}`, ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    `job-${l1.id}`,
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: '阿岚',
          summary: '角色与偏好',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  return f.l2
    .listMemories({ ownerSpaceId: 'personal' }, personal)
    .find((memory) => memory.l1Ids.includes(l1.id));
}

const pluginContext = {
  plugin: { id: 'pmem.memory', version: '1.0.0' },
  binding: { workspaceId: 'pmem', agentId: 'ag_test', sessionId: 's_test' },
  generation: 1,
  callId: 'call_1',
  capabilities: [],
  signal: new AbortController().signal,
  tool: {
    name: 'pmem_recall',
    actionRef: 'pmem_recall',
    schemaVersion: '1',
    resultSchemaId: 'unknown',
    resultVersion: 1,
    effectClass: 'read',
  },
};

test('AgentMemory resolves through a trusted host scope and formats bounded context', async (t) => {
  const f = fixture(t);
  const l1 = await makeL1(f, 'l1-latte', '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1);
  const memory = new f.AgentMemory(f.db);
  const host = f.createSingleUserAgentHost();
  const scope = host.scope({ workspaceId: 'pmem', agentId: 'ag', sessionId: 's' });

  const result = memory.resolve('拿铁', scope.anchoredSpaceIds, scope.access);
  assert.equal(result.l2.length, 1);
  assert.equal(result.l2[0].id, l2.id);
  const formatted = require(path.join(f.root, 'dist/agent/memory')).formatRecall(result);
  assert.match(formatted.text, /<pmem_memory>/);
  assert.match(formatted.text, new RegExp(l2.id));
  assert.match(formatted.text, /阿岚喜欢拿铁/);
  assert.equal(formatted.details.l2[0].id, l2.id);
});

test('PMEM plugin exposes read-only tools bounded by the host scope', async (t) => {
  const f = fixture(t);
  const l1 = await makeL1(f, 'l1-latte', '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1);
  const memory = new f.AgentMemory(f.db);
  const host = f.createSingleUserAgentHost();
  const plugin = await f.createPmemMemoryPlugin(memory, host);

  assert.equal(plugin.manifest.id, 'pmem.memory');
  assert.deepEqual(
    plugin.manifest.tools.map((tool) => [tool.name, tool.effect]),
    [
      ['pmem_recall', 'read'],
      ['pmem_get', 'read'],
    ]
  );

  const recall = await plugin.bindings.actions.pmem_recall(
    { query: '拿铁', topK: 5 },
    pluginContext
  );
  assert.match(recall.content[0].text, new RegExp(l2.id));
  assert.equal(recall.details.l2[0].id, l2.id);

  const get = await plugin.bindings.actions.pmem_get({ kind: 'l2', id: l2.id }, pluginContext);
  assert.match(get.content[0].text, /阿岚喜欢拿铁/);
  assert.match(get.content[0].text, /status="current"/);

  await assert.rejects(
    plugin.bindings.actions.pmem_recall(
      { query: '拿铁' },
      { ...pluginContext, binding: { ...pluginContext.binding, workspaceId: 'other' } }
    ),
    /No PMEM memory scope/
  );
});

test('PmemAgentRuntime uses MiaoTs and captures the conversation into L0', async (t) => {
  const f = fixture(t);
  const runtime = await f.PmemAgentRuntime.create({
    database: f.db,
    agentDatabasePath: path.join(f.root, 'agent.sqlite'),
    faux: true,
  });
  try {
    const result = await runtime.prompt('hello');
    assert.equal(result.text, 'The task is complete.');
    await runtime.flushCapture();
    const page = runtime.memory.listL0({ spaceId: 'personal' }, personal);
    assert.deepEqual(
      page.messages.map((message) => message.role),
      ['user', 'assistant']
    );
    assert.equal(page.messages[0].content, 'hello');
    assert.equal(page.messages[0].source, 'pmem.agent');
    assert.equal(page.messages[1].content, 'The task is complete.');
    assert.equal(page.messages[1].sessionId, runtime.sessionId);
  } finally {
    await runtime.close();
  }
});
