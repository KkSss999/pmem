'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-agent-'));
process.on('exit', () => fs.rmSync(sharedRoot, { recursive: true, force: true }));
fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(sharedRoot, 'dist'), { recursive: true });
fs.cpSync(path.join(__dirname, '..', 'migrations'), path.join(sharedRoot, 'migrations'), {
  recursive: true,
});
fs.symlinkSync(
  path.join(__dirname, '..', 'node_modules'),
  path.join(sharedRoot, 'node_modules'),
  'dir'
);
let caseIndex = 0;
function fixture(t) {
  const root = path.join(sharedRoot, `case-${++caseIndex}`);
  fs.mkdirSync(root);
  const { OwnedDatabase } = require(path.join(sharedRoot, 'dist/db/database'));
  const { assembleL1 } = require(path.join(sharedRoot, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(sharedRoot, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(sharedRoot, 'dist/server/l2'));
  const { AgentMemory } = require(path.join(sharedRoot, 'dist/agent/memory'));
  const { createSingleUserAgentHost } = require(path.join(sharedRoot, 'dist/agent/access'));
  const { createPmemMemoryPlugin } = require(path.join(sharedRoot, 'dist/agent/plugin'));
  const { PmemAgentRuntime } = require(path.join(sharedRoot, 'dist/agent/runtime'));
  const db = OwnedDatabase.create(path.join(root, 'memory.sqlite'));
  return {
    root: sharedRoot,
    caseRoot: root,
    db,
    memoryService: require(path.join(sharedRoot, 'dist/server/memory')).assembleMemory(db),
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
  const preparation = f.l1.prepareStream(source.id, personal);
  const [memory] = f.l1.applyStream(
    preparation,
    {
      memories: [
        {
          content,
          abstraction: '主题',
          cues: ['线索'],
          sourceIds: [source.id],
          relatedSpaceIds: [],
        },
      ],
    },
    personal
  );
  const maintenance = f.maintenance.prepareStream(memory.id, personal);
  f.maintenance.applyStream(maintenance, { decisions: [keep(memory.id)] }, personal);
  return f.l1.getMemory(memory.id, personal);
}

async function makeL2(f, l1) {
  const preparation = await f.l2.prepareStream(l1.id, personal);
  const result = f.l2.applyStream(
    preparation,
    {
      results: [
        {
          action: 'create',
          title: '阿岚',
          summary: '角色与偏好',
          body: l1.content,
          l1Ids: [l1.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    personal
  );
  return f.l2.getMemory(result.l2Ids[0], personal);
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
    agentDatabasePath: path.join(f.caseRoot, 'agent.sqlite'),
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

test('PmemAgentRuntime persists Sessions across process-local runtimes', async (t) => {
  const f = fixture(t);
  const agentDatabasePath = path.join(f.caseRoot, 'agent.sqlite');
  const first = await f.PmemAgentRuntime.create({
    database: f.db,
    agentDatabasePath,
    faux: true,
  });
  const sessionId = first.sessionId;
  try {
    await first.prompt('remember this');
    await first.flushCapture();
  } finally {
    await first.close();
  }

  const second = await f.PmemAgentRuntime.create({
    database: f.db,
    agentDatabasePath,
    faux: true,
  });
  try {
    const sessions = await second.listSessions();
    const persisted = sessions.find((session) => session.sessionId === sessionId);
    assert.ok(persisted);
    const transcript = await second.sessionTranscript(persisted.sessionId, persisted.agentId);
    assert.ok(transcript.messages.length >= 2);
  } finally {
    await second.close();
  }
});

test('PmemAgentRuntime auto-recalls memory into appended context and records model usage', async (t) => {
  const f = fixture(t);
  const l1 = await makeL1(f, 'l1-auto-recall', '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1);
  const runtime = await f.PmemAgentRuntime.create({
    database: f.db,
    agentDatabasePath: path.join(f.caseRoot, 'agent.sqlite'),
    faux: true,
  });
  try {
    const plugin = await f.createPmemMemoryPlugin(runtime.memory, f.createSingleUserAgentHost(), {
      queryFor: () => '拿铁',
    });
    const read = plugin.bindings.contexts?.['pmem-recall'];
    assert.equal(typeof read, 'function');
    const contributions = await read(pluginContext);
    assert.equal(contributions.length, 1);
    assert.equal(contributions[0].kind, 'messages');
    assert.match(contributions[0].messages[0].content, /阿岚喜欢拿铁/);

    await runtime.prompt('拿铁');
    const context = await runtime.contextSnapshot();
    assert.ok(context);
    assert.ok(
      context.manifest.some((entry) => entry.providerId.includes('pmem.memory')),
      'plugin recall should appear in the prepared context'
    );
    const calls = runtime.modelCalls();
    assert.ok(calls.length > 0);
    assert.equal(calls[0].sessionId, runtime.sessionId);
    assert.ok(calls[0].usage);
    assert.ok(calls[0].usage.tokens.total > 0);
    assert.ok(calls[0].usage.tokens.cacheWrite > 0);
    const cache = runtime.cacheMetrics();
    assert.equal(cache.length, calls.length);
    assert.ok(cache[0].hitRate >= 0 && cache[0].hitRate <= 1);
    assert.equal(cache[0].cacheWrite, calls[0].usage.tokens.cacheWrite);
  } finally {
    await runtime.close();
  }
});

test('Pmem SDK exposes the Agent runtime over its own database', async (t) => {
  const f = fixture(t);
  const { Pmem } = require(path.join(f.root, 'dist/sdk/index'));
  const pmem = Pmem.create({ databasePath: path.join(f.caseRoot, 'sdk-memory.sqlite') });
  const runtime = await pmem.agent({
    agentDatabasePath: path.join(f.caseRoot, 'sdk-agent.sqlite'),
    faux: true,
  });
  try {
    const result = await runtime.prompt('sdk hello');
    assert.equal(result.text, 'The task is complete.');
  } finally {
    await runtime.close();
    pmem.close();
  }
});
