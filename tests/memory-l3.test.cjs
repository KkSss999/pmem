'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-l3-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const dir of ['sdk', 'server', 'db', 'domain', 'service', 'other']) {
    fs.cpSync(path.join(__dirname, '..', 'dist', dir), path.join(root, 'dist', dir), {
      recursive: true,
    });
  }
  fs.cpSync(path.join(__dirname, '..', 'migrations'), path.join(root, 'migrations'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { OwnedDatabase } = require(path.join(root, 'dist/db/database'));
  const { SqliteL3Repository } = require(path.join(root, 'dist/db/memory/l3-repository'));
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  const { assembleL1 } = require(path.join(root, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(root, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(root, 'dist/server/l2'));
  const { assembleL3 } = require(path.join(root, 'dist/server/l3'));
  const { assembleL3Scheduler } = require(path.join(root, 'dist/server/l3-scheduler'));
  const { OpenAIExtractionModel } = require(path.join(root, 'dist/other/models/openai'));
  const databasePath = path.join(root, 'memory.sqlite');
  const db = OwnedDatabase.create(databasePath);
  return {
    root,
    databasePath,
    db,
    OwnedDatabase,
    assembleL1,
    assembleL2,
    assembleL3,
    assembleL3Scheduler,
    OpenAIExtractionModel,
    memory: assembleMemory(db),
    l1: assembleL1(db),
    maintenance: assembleL1Maintenance(db),
    l2: assembleL2(db),
    l3: assembleL3(db),
    seed(input) {
      return db.createAdapter((orm) => new SqliteL3Repository(orm).upsertKeyword(input));
    },
  };
}

const personal = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const code = (name) => (error) => error?.code === name;
async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}
const keep = (memoryId) => ({
  memoryId,
  action: 'keep',
  targetId: null,
  content: null,
  abstraction: null,
  cues: [],
});

async function makeL1(f, jobId, spaceId, relatedSpaceIds, access, content) {
  const source = f.memory.appendL0(
    { spaceId, role: 'user', content: `source ${jobId} ${content}` },
    access
  ).message;
  f.l1.enqueue({ id: jobId, sourceIds: [source.id], relatedSpaceIds }, access);
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
            relatedSpaceIds,
          },
        ],
      }),
    },
    access
  );
  const memory = f.l1.getJobMemories(jobId, access)[0];
  const work = f.maintenance.startBatch(
    {
      review: async ({ cases }) => ({ decisions: cases.map((item) => keep(item.memory.id)) }),
    },
    access
  );
  if (work) await work;
  return { source, memory: f.l1.getMemory(memory.id, access) };
}

async function makeL2(f, l1, ownerSpaceId, access) {
  f.l2.recordChange({ l1Id: l1.id, kind: 'created' }, access);
  f.l2.enqueue({ id: `job-${l1.id}`, ownerSpaceId }, access);
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
    access
  );
  return f.l2.listMemories({ ownerSpaceId }, access).find((memory) => memory.l1Ids.includes(l1.id));
}

test('L3 matches keywords and aliases, resolves facts, and records hits', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const { source, memory: l1 } = await makeL1(
    f,
    'l1-a',
    project.id,
    ['personal'],
    both,
    '阿岚喜欢拿铁。'
  );
  const l2 = await makeL2(f, l1, project.id, both);
  const now = new Date().toISOString();
  const keyword = f.seed({
    term: '拿铁',
    aliases: ['latte'],
    kind: 'preference',
    baseWeight: 4,
    relatedSpaceIds: [project.id, 'personal'],
    sourceL2Ids: [l2.id],
    now,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(keyword.normalizedTerm, '拿铁');

  const matches = f.l3.match('拿铁', ['personal'], both);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].sourceL2Ids, [l2.id]);
  assert.deepEqual(matches[0].aliases, ['latte']);
  assert.equal(matches[0].hitCount, 0);

  assert.equal(f.l3.match('latte', ['personal'], both).length, 1);
  assert.equal(f.l3.list(['personal'], both).length, 1);

  const hit = f.l3.getKeyword(keyword.id, both);
  assert.equal(hit.hitCount, 2);
  assert.equal(hit.weight, 6);

  const result = f.l3.resolve('拿铁', ['personal'], both);
  assert.equal(result.cacheHit, true);
  assert.equal(result.fallback, 'none');
  assert.equal(result.mixed, false);
  assert.equal(result.keywords.length, 1);
  assert.equal(result.l2.length, 1);
  assert.equal(result.l1.length, 1);
  assert.deepEqual(result.l0SourceIds, [source.id]);
  assert.equal(result.complete, true);
  assert.equal(f.l3.searchIndexStatus(both), 'healthy');
  f.l3.rebuildSearchIndex(both);
  assert.equal(f.l3.searchIndexStatus(both), 'healthy');

  const raw = new Database(f.databasePath);
  raw.exec('DROP TABLE memory_l3_fts');
  raw.close();
  assert.equal(f.l3.searchIndexStatus(both), 'missing');
  assert.throws(() => f.l3.match('latte', ['personal'], both), code('L3_INDEX_MISSING'));
  const degraded = f.l3.resolve('latte', ['personal'], both);
  assert.equal(degraded.cacheHit, false);
  assert.equal(degraded.complete, false);
  f.l3.rebuildSearchIndex(both);
  assert.equal(f.l3.match('latte', ['personal'], both).length, 1);
});

test('L3 falls back to L2 and then L1 when keywords are absent or expired', async (t) => {
  const f = fixture(t);
  const { memory: l1 } = await makeL1(f, 'l1-b', 'personal', [], personal, '阿岚住在北城。');
  const l2 = await makeL2(f, l1, 'personal', personal);
  const now = new Date().toISOString();
  const expired = f.seed({
    term: '旧词',
    aliases: [],
    kind: 'other',
    baseWeight: 1,
    relatedSpaceIds: ['personal'],
    sourceL2Ids: [l2.id],
    now,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const raw = new Database(f.databasePath);
  raw
    .prepare('UPDATE memory_l3_keywords SET expires_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', expired.id);
  raw.close();

  assert.equal(f.l3.getKeyword(expired.id, personal), undefined);
  assert.equal(f.l3.match('旧词', ['personal'], personal).length, 0);
  const result = f.l3.resolve('北城', ['personal'], personal);
  assert.equal(result.cacheHit, false);
  assert.equal(result.fallback, 'l2');
  assert.equal(result.keywords.length, 0);
  assert.equal(result.l2.length, 1);
  assert.equal(result.l1.length, 1);

  const noL2 = await makeL1(f, 'l1-c', 'personal', [], personal, '只存在于 L1 的线索。');
  const l1Only = f.l3.resolve('只存在于', ['personal'], personal);
  assert.equal(l1Only.fallback, 'l1');
  assert.equal(l1Only.l2.length, 0);
  assert.ok(l1Only.l1.some((item) => item.id === noL2.memory.id));
});

test('L3 scopes, merges duplicate terms and rejects indexed fallback when closed', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const { memory: l1 } = await makeL1(f, 'l1-d', project.id, ['personal'], both, '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1, project.id, both);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  f.seed({
    term: '拿铁',
    aliases: ['latte'],
    kind: 'preference',
    baseWeight: 3,
    relatedSpaceIds: [project.id],
    sourceL2Ids: [l2.id],
    now,
    expiresAt,
  });
  f.seed({
    term: '拿铁',
    aliases: ['牛奶咖啡'],
    kind: 'preference',
    baseWeight: 5,
    relatedSpaceIds: ['personal'],
    sourceL2Ids: [l2.id],
    now,
    expiresAt,
  });
  const merged = f.l3.match('拿铁', ['personal', project.id], both);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].weight, 8);
  assert.deepEqual([...merged[0].relatedSpaceIds].sort(), ['personal', project.id].sort());
  assert.deepEqual(merged[0].aliases.sort(), ['latte', '牛奶咖啡']);
  assert.equal(f.l3.match('拿铁', ['personal'], personal).length, 1);

  f.db.close();
  const readOnly = f.OwnedDatabase.open(f.databasePath, true);
  const l3 = f.assembleL3(readOnly);
  assert.equal(l3.match('拿铁', ['personal'], personal).length, 1);
  assert.throws(() => l3.rebuildSearchIndex(both), code('READ_ONLY'));
  readOnly.close();
});

test('L2 commits register L3 changes, refresh scopes, and support cold start', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const { memory: l1 } = await makeL1(f, 'l1-e', project.id, ['personal'], both, '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1, project.id, both);
  const created = f.l3.listChanges(both).filter((change) => change.l2Id === l2.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'created');
  assert.equal(created[0].state, 'pending');

  const keyword = f.seed({
    term: '拿铁',
    aliases: ['latte'],
    kind: 'preference',
    baseWeight: 4,
    relatedSpaceIds: [project.id, 'personal'],
    sourceL2Ids: [l2.id],
    now: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  const second = await makeL1(f, 'l1-f', project.id, ['personal'], both, '阿岚也喜欢北城。');
  f.l2.recordChange({ l1Id: second.memory.id, kind: 'created' }, both);
  f.l2.enqueue({ id: 'l2-update', ownerSpaceId: project.id }, both);
  await f.l2.run(
    'l2-update',
    {
      generate: async () => ({
        results: [
          {
            action: 'update',
            l2Id: l2.id,
            title: '阿岚',
            summary: '角色与偏好',
            body: '阿岚喜欢拿铁，也喜欢北城。',
            l1Ids: [l1.id, second.memory.id],
          },
        ],
        uncoveredL1Ids: [],
      }),
    },
    both
  );
  assert.equal(f.l3.getKeyword(keyword.id, both).needsRefresh, true);
  assert.ok(
    f.l3.listChanges(both).some((change) => change.l2Id === l2.id && change.kind === 'updated')
  );

  f.l1.updateSpaceLinks(l1.id, [], both);
  const narrowed = f.l3.getKeyword(keyword.id, both);
  assert.deepEqual(narrowed.relatedSpaceIds, [project.id]);
  assert.equal(narrowed.needsRefresh, true);

  const before = f.l3.listChanges(both).filter((change) => change.l2Id === l2.id).length;
  assert.equal(f.l3.enqueueColdStart(both), 1);
  assert.equal(f.l3.listChanges(both).filter((change) => change.l2Id === l2.id).length, before);
});

test('L1 merge keeps L3 keyword sources and marks them for refresh', async (t) => {
  const f = fixture(t);
  const target = await makeL1(f, 'merge-target', 'personal', [], personal, '目标记忆。');
  const source = await makeL1(f, 'merge-source', 'personal', [], personal, '来源记忆。');
  const l2 = await makeL2(f, source.memory, 'personal', personal);
  const keyword = f.seed({
    term: '来源',
    aliases: [],
    kind: 'topic',
    baseWeight: 2,
    relatedSpaceIds: ['personal'],
    sourceL2Ids: [l2.id],
    now: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const raw = new Database(f.databasePath);
  raw
    .prepare(
      "UPDATE memory_l1_maintenance_tasks SET state='pending', outcome=NULL, result_memory_id=? WHERE memory_id=?"
    )
    .run(source.memory.id, source.memory.id);
  raw.prepare("UPDATE memory_l1 SET maintenance_status='pending' WHERE id=?").run(source.memory.id);
  raw.close();
  await f.maintenance.startBatch(
    {
      review: async () => ({
        decisions: [
          {
            memoryId: source.memory.id,
            action: 'merge',
            targetId: target.memory.id,
            content: '合并后的记忆。',
            abstraction: '合并主题',
            cues: ['合并线索'],
          },
        ],
      }),
    },
    personal
  );
  const refreshed = f.l3.getKeyword(keyword.id, personal);
  assert.equal(refreshed.needsRefresh, true);
  assert.deepEqual(refreshed.sourceL2Ids, [l2.id]);
  assert.ok(
    f.l3.listChanges(personal).some((change) => change.l2Id === l2.id && change.kind === 'updated')
  );
});

test('L3 generation claims changes, validates output and expires keywords', async (t) => {
  const f = fixture(t);
  const { memory: l1 } = await makeL1(f, 'l1-gen', 'personal', [], personal, '阿岚喜欢拿铁。');
  const l2 = await makeL2(f, l1, 'personal', personal);
  f.l3.enqueue({ id: 'l3-gen' }, personal);
  const job = await f.l3.run(
    'l3-gen',
    {
      promptVersion: 'test-l3',
      generateKeywords: async ({ changes, keywords }) => {
        assert.equal(changes.length, 1);
        assert.equal(keywords.length, 0);
        return {
          keywords: [
            {
              term: '拿铁',
              aliases: ['latte'],
              kind: 'preference',
              baseWeight: 4,
              l2Ids: [changes[0].memory.id],
            },
          ],
        };
      },
    },
    personal
  );
  assert.equal(job.state, 'succeeded');
  assert.equal(job.promptVersion, 'test-l3');
  const [keyword] = f.l3.match('拿铁', ['personal'], personal);
  assert.equal(keyword.sourceL2Ids[0], l2.id);
  assert.ok(
    f.l3
      .listChanges(personal)
      .every((change) => change.l2Id !== l2.id || change.state === 'processed')
  );

  const raw = new Database(f.databasePath);
  raw
    .prepare('UPDATE memory_l3_keywords SET expires_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', keyword.keywordIds[0]);
  raw.close();
  assert.equal(f.l3.expire(personal), 1);
  assert.equal(f.l3.match('拿铁', ['personal'], personal).length, 0);
  const aged = new Database(f.databasePath);
  aged
    .prepare('UPDATE memory_l3_keywords SET updated_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', keyword.keywordIds[0]);
  aged.close();
  assert.equal(f.l3.expire(personal), 0);
  const cleaned = new Database(f.databasePath, { readonly: true });
  assert.equal(
    cleaned
      .prepare('SELECT count(*) AS n FROM memory_l3_keywords WHERE id = ?')
      .get(keyword.keywordIds[0]).n,
    0
  );
  cleaned.close();

  f.l3.enqueueColdStart(personal);
  f.l3.enqueue({ id: 'l3-bad' }, personal);
  const before = f.l3.listChanges(personal).length;
  await assert.rejects(
    f.l3.run(
      'l3-bad',
      {
        generateKeywords: async () => ({
          keywords: [{ term: '拿铁', aliases: [], kind: 'preference', baseWeight: 4, l2Ids: [] }],
        }),
      },
      personal
    ),
    code('L3_MODEL_OUTPUT_INVALID')
  );
  assert.equal(f.l3.getJob('l3-bad', personal).state, 'failed');
  assert.ok(f.l3.listChanges(personal).length >= before);

  assert.equal(f.l3.retry('l3-bad', personal).state, 'pending');
  const retried = await f.l3.run(
    'l3-bad',
    {
      generateKeywords: async ({ changes }) => ({
        keywords: [
          {
            term: '北城',
            aliases: [],
            kind: 'topic',
            baseWeight: 2,
            l2Ids: [changes[0].memory.id],
          },
        ],
      }),
    },
    personal
  );
  assert.equal(retried.state, 'succeeded');
  assert.equal(f.l3.match('北城', ['personal'], personal).length, 1);
});

for (const api of ['chat', 'responses']) {
  test(`L3 ${api} adapter sends one structured keyword request`, async () => {
    const f = fixture({ after() {} });
    let calls = 0;
    const model = new f.OpenAIExtractionModel({
      api,
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://example.test/v1',
      fetch: async (url, options) => {
        calls++;
        assert.equal(
          url,
          `https://example.test/v1/${api === 'chat' ? 'chat/completions' : 'responses'}`
        );
        assert.equal(options.headers.authorization, 'Bearer test-key');
        const request = JSON.parse(options.body);
        assert.equal(request.store, false);
        const format = api === 'chat' ? request.response_format.json_schema : request.text.format;
        assert.equal(format.name, 'pmem_l3_keywords');
        assert.equal(format.strict, true);
        const system = api === 'chat' ? request.messages[0].content : request.input[0].content;
        assert.match(system, /L3 keywords/);
        assert.match(system, /baseWeight/);
        const user = JSON.parse(
          api === 'chat' ? request.messages[1].content : request.input[1].content
        );
        assert.equal(user.changedL2[0].memory.id, 'l2-1');
        const content = JSON.stringify({
          keywords: [
            {
              term: '拿铁',
              aliases: ['latte'],
              kind: 'preference',
              baseWeight: 4,
              l2Ids: ['l2-1'],
            },
          ],
        });
        const payload =
          api === 'chat'
            ? { choices: [{ finish_reason: 'stop', message: { content } }] }
            : {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }],
              };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(model.l3PromptVersion, 'l3-v1');
    const result = await model.generateKeywords({
      changes: [
        {
          change: {
            id: 'change-1',
            l2Id: 'l2-1',
            kind: 'created',
            l2Hash: 'hash',
            state: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          memory: {
            id: 'l2-1',
            ownerSpaceId: 'personal',
            title: '阿岚',
            summary: '偏好',
            body: '阿岚喜欢拿铁。',
            contentHash: 'hash',
            needsUpdate: false,
            visible: true,
            generationId: 'generation',
            relatedSpaceIds: [],
            l1Ids: ['l1-1'],
            sourceIds: ['l0-1'],
            sourcesComplete: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      keywords: [],
      now: '2026-01-01T00:00:00.000Z',
    });
    assert.deepEqual(result, {
      keywords: [
        {
          term: '拿铁',
          aliases: ['latte'],
          kind: 'preference',
          baseWeight: 4,
          l2Ids: ['l2-1'],
        },
      ],
    });
    assert.equal(calls, 1);
    f.db.close();
  });
}

test('L3 scheduler processes pending changes and stops cleanly', async (t) => {
  const f = fixture(t);
  const { memory: l1 } = await makeL1(f, 'l1-schedule', 'personal', [], personal, '阿岚喜欢拿铁。');
  await makeL2(f, l1, 'personal', personal);
  const scheduler = f.assembleL3Scheduler(
    f.db,
    {
      generateKeywords: async ({ changes }) => ({
        keywords: [
          {
            term: '拿铁',
            aliases: [],
            kind: 'preference',
            baseWeight: 3,
            l2Ids: [changes[0].memory.id],
          },
        ],
      }),
    },
    personal,
    { batchSize: 1, idleMs: 1, maxWaitMs: 1 }
  );
  scheduler.start();
  await waitFor(() => f.l3.match('拿铁', ['personal'], personal).length === 1);
  await scheduler.stop();
  assert.equal(scheduler.status().running, false);
  assert.equal(
    f.l3.listChanges(personal).every((change) => change.state !== 'pending'),
    true
  );
  f.db.close();
});
