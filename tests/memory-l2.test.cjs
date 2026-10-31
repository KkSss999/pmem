'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-l2-'));
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
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  const { assembleL1 } = require(path.join(root, 'dist/server/l1'));
  const { assembleL1Maintenance } = require(path.join(root, 'dist/server/l1-maintenance'));
  const { assembleL2 } = require(path.join(root, 'dist/server/l2'));
  const { assembleL2Scheduler } = require(path.join(root, 'dist/server/l2-scheduler'));
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
    assembleL2Scheduler,
    OpenAIExtractionModel,
    memory: assembleMemory(db),
    l1: assembleL1(db),
    maintenance: assembleL1Maintenance(db),
    l2: assembleL2(db),
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
  const complete = f.l1.getMemory(memory.id, access);
  assert.equal(complete.maintenanceStatus, 'complete');
  return { source, memory: complete };
}

test('L2 creates from completed L1, preserves links and recalls across shared spaces', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const { source, memory: l1 } = await makeL1(
    f,
    'l1-create',
    project.id,
    ['personal'],
    both,
    '阿岚住在北城，喜欢拿铁。'
  );
  const change = f.l2.recordChange({ l1Id: l1.id, kind: 'created' }, both);
  assert.equal(change.state, 'pending');
  assert.equal(change.ownerSpaceId, project.id);
  f.l2.enqueue({ id: 'l2-create', ownerSpaceId: project.id }, both);
  const calls = [];
  const job = await f.l2.run(
    'l2-create',
    {
      generate: async ({ changes, candidates }) => {
        calls.push({ changes, candidates });
        return {
          results: [
            {
              action: 'create',
              title: '阿岚与北城',
              summary: '角色与居所',
              body: '阿岚住在北城，喜欢拿铁。',
              l1Ids: [l1.id],
            },
          ],
          uncoveredL1Ids: [],
        };
      },
    },
    both
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].changes.length, 1);
  assert.equal(calls[0].candidates.length, 0);
  assert.equal(job.state, 'succeeded');

  const [created] = f.l2.listMemories({ ownerSpaceId: project.id }, both);
  assert.equal(created.title, '阿岚与北城');
  assert.deepEqual(created.l1Ids, [l1.id]);
  assert.deepEqual(created.sourceIds, [source.id]);
  assert.deepEqual(created.relatedSpaceIds, ['personal']);
  assert.equal(created.sourcesComplete, true);

  assert.equal(f.l2.recall({ query: '北城', anchoredSpaceIds: ['personal'] }, both).length, 1);
  assert.equal(f.l2.recall({ query: '拿铁', anchoredSpaceIds: [project.id] }, both).length, 1);
  assert.throws(
    () => f.l2.recall({ query: '北城', anchoredSpaceIds: [project.id] }, personal),
    code('ACCESS_DENIED')
  );

  const personalOnly = f.l2.recall({ query: '北城', anchoredSpaceIds: ['personal'] }, personal);
  assert.equal(personalOnly.length, 1);
  assert.deepEqual(personalOnly[0].sourceIds, []);
  assert.equal(personalOnly[0].sourcesComplete, false);
  assert.equal(f.l2.searchIndexStatus(both), 'healthy');
  f.l2.rebuildSearchIndex(both);
  assert.equal(f.l2.searchIndexStatus(both), 'healthy');

  const raw = new Database(f.databasePath);
  raw.exec('DROP TABLE memory_l2_search');
  raw.close();
  assert.equal(f.l2.searchIndexStatus(both), 'missing');
  assert.throws(
    () => f.l2.recall({ query: '北城', anchoredSpaceIds: ['personal'] }, both),
    code('L2_INDEX_MISSING')
  );
  f.l2.rebuildSearchIndex(both);
  assert.equal(f.l2.recall({ query: '北城', anchoredSpaceIds: ['personal'] }, both).length, 1);
});

test('L2 update must preserve existing L1 links and retry resumes failed changes', async (t) => {
  const f = fixture(t);
  const first = await makeL1(f, 'l1-a', 'personal', [], personal, '阿岚喜欢拿铁。');
  f.l2.recordChange({ l1Id: first.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-a', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'l2-a',
    {
      generate: async () => ({
        results: [
          {
            action: 'create',
            title: '阿岚',
            summary: '角色',
            body: '阿岚喜欢拿铁。',
            l1Ids: [first.memory.id],
          },
        ],
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  const [existing] = f.l2.listMemories({ ownerSpaceId: 'personal' }, personal);

  const second = await makeL1(f, 'l1-b', 'personal', [], personal, '阿岚住在北城。');
  f.l2.recordChange({ l1Id: second.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-b', ownerSpaceId: 'personal' }, personal);
  await assert.rejects(
    f.l2.run(
      'l2-b',
      {
        generate: async () => ({
          results: [
            {
              action: 'update',
              l2Id: existing.id,
              title: '阿岚',
              summary: '角色',
              body: '阿岚住在北城。',
              l1Ids: [second.memory.id],
            },
          ],
          uncoveredL1Ids: [],
        }),
      },
      personal
    ),
    code('L2_MODEL_FAILED')
  );
  assert.equal(f.l2.getJob('l2-b', personal).state, 'failed');
  assert.equal(f.l2.listChanges({ ownerSpaceId: 'personal' }, personal)[0].state, 'failed');
  assert.deepEqual(f.l2.getMemory(existing.id, personal).l1Ids, [first.memory.id]);

  assert.equal(f.l2.retry('l2-b', personal).state, 'pending');
  await f.l2.run(
    'l2-b',
    {
      generate: async ({ candidates }) => {
        assert.ok(candidates.some((candidate) => candidate.memory.id === existing.id));
        return {
          results: [
            {
              action: 'update',
              l2Id: existing.id,
              title: '阿岚',
              summary: '角色与居所',
              body: '阿岚喜欢拿铁，也住在北城。',
              l1Ids: [first.memory.id, second.memory.id],
            },
          ],
          uncoveredL1Ids: [],
        };
      },
    },
    personal
  );
  const updated = f.l2.getMemory(existing.id, personal);
  assert.equal(updated.summary, '角色与居所');
  assert.deepEqual([...updated.l1Ids].sort(), [first.memory.id, second.memory.id].sort());
  assert.equal(f.l2.getJob('l2-b', personal).state, 'succeeded');
});

test('L2 partial commit failures and uncovered changes are observable', async (t) => {
  const f = fixture(t);
  const stable = await makeL1(f, 'l1-stable', 'personal', [], personal, '稳定记忆。');
  const changed = await makeL1(f, 'l1-changed', 'personal', [], personal, '会变化的记忆。');
  f.l2.recordChange({ l1Id: stable.memory.id, kind: 'created' }, personal);
  f.l2.recordChange({ l1Id: changed.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-partial', ownerSpaceId: 'personal' }, personal);
  const job = await f.l2.run(
    'l2-partial',
    {
      generate: async ({ changes }) => {
        const raw = new Database(f.databasePath);
        raw
          .prepare('UPDATE memory_l1 SET content = ? WHERE id = ?')
          .run('变化后的内容', changed.memory.id);
        raw.close();
        return {
          results: changes.map((item) => ({
            action: 'create',
            title: item.memory.content,
            summary: '摘要',
            body: item.memory.content,
            l1Ids: [item.memory.id],
          })),
          uncoveredL1Ids: [],
        };
      },
    },
    personal
  );
  assert.equal(job.state, 'partial');
  const changes = f.l2.listChanges({ ownerSpaceId: 'personal' }, personal);
  assert.equal(changes.find((change) => change.l1Id === stable.memory.id).state, 'processed');
  assert.equal(changes.find((change) => change.l1Id === changed.memory.id).state, 'failed');
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, personal).length, 1);
  assert.equal(f.l2.retry('l2-partial', personal).state, 'pending');
  const retried = await f.l2.run(
    'l2-partial',
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: '重试后的记忆',
          summary: '摘要',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  assert.equal(retried.state, 'succeeded');
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, personal).length, 2);

  const third = await makeL1(f, 'l1-uncovered', 'personal', [], personal, '只是一句寒暄。');
  f.l2.recordChange({ l1Id: third.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-uncovered', ownerSpaceId: 'personal' }, personal);
  const uncoveredJob = await f.l2.run(
    'l2-uncovered',
    {
      generate: async () => ({
        results: [],
        uncoveredL1Ids: [{ l1Id: third.memory.id, reason: '没有长期价值' }],
      }),
    },
    personal
  );
  assert.equal(uncoveredJob.state, 'succeeded');
  assert.equal(
    f.l2
      .listChanges({ ownerSpaceId: 'personal' }, personal)
      .find((change) => change.l1Id === third.memory.id).state,
    'uncovered'
  );
});

test('L2 rejects mixed owners, read-only writes and invalid model coverage', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const personalL1 = await makeL1(f, 'l1-p', 'personal', [], both, '个人记忆。');
  const projectL1 = await makeL1(f, 'l1-x', project.id, [], both, '项目记忆。');
  f.l2.recordChange({ l1Id: personalL1.memory.id, kind: 'created' }, both);
  f.l2.recordChange({ l1Id: projectL1.memory.id, kind: 'created' }, both);
  assert.equal(f.l2.listChanges({ ownerSpaceId: 'personal' }, both).length, 1);
  assert.equal(f.l2.listChanges({ ownerSpaceId: project.id }, both).length, 1);

  f.l2.enqueue({ id: 'l2-p', ownerSpaceId: 'personal' }, both);
  await assert.rejects(
    f.l2.run(
      'l2-p',
      {
        generate: async () => ({
          results: [
            {
              action: 'create',
              title: '混合',
              summary: '摘要',
              body: '正文',
              l1Ids: [personalL1.memory.id, projectL1.memory.id],
            },
          ],
          uncoveredL1Ids: [],
        }),
      },
      both
    ),
    code('L2_MODEL_FAILED')
  );

  f.db.close();
  const readonly = f.OwnedDatabase.open(f.databasePath, true);
  const reader = f.assembleL2(readonly);
  assert.throws(
    () => reader.recordChange({ l1Id: personalL1.memory.id, kind: 'created' }, both),
    code('READ_ONLY')
  );
  assert.throws(
    () => reader.enqueue({ id: 'readonly', ownerSpaceId: 'personal' }, both),
    code('READ_ONLY')
  );
  assert.throws(() => reader.rebuildSearchIndex(both), code('READ_ONLY'));
  readonly.close();
});

test('L2 scheduler batches by count and by idle time', async (t) => {
  const f = fixture(t);
  const one = await makeL1(f, 'sched-a', 'personal', [], personal, '第一批记忆。');
  const two = await makeL1(f, 'sched-b', 'personal', [], personal, '第二批记忆。');
  const scheduler = f.assembleL2Scheduler(
    f.db,
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: item.memory.content,
          summary: '摘要',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    personal,
    { batchSize: 2, idleMs: 5000, maxWaitMs: 5000 }
  );
  scheduler.start();
  await waitFor(() => f.l2.listMemories({ ownerSpaceId: 'personal' }, personal).length === 2);
  await scheduler.stop();
  const memories = f.l2.listMemories({ ownerSpaceId: 'personal' }, personal);
  assert.equal(memories.length, 2);
  assert.deepEqual(
    memories.flatMap((memory) => memory.l1Ids).sort(),
    [one.memory.id, two.memory.id].sort()
  );
  assert.equal(f.l2.getJob('missing', personal), undefined);

  const third = await makeL1(f, 'sched-c', 'personal', [], personal, '空闲后的一批。');
  const idleScheduler = f.assembleL2Scheduler(
    f.db,
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: item.memory.content,
          summary: '摘要',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    personal,
    { batchSize: 10, idleMs: 1, maxWaitMs: 5000 }
  );
  idleScheduler.start();
  await waitFor(() =>
    f.l2
      .listMemories({ ownerSpaceId: 'personal' }, personal)
      .some((memory) => memory.l1Ids.includes(third.memory.id))
  );
  await idleScheduler.stop();
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, personal).length, 3);
});

test('L1 maintenance records L2 changes and merges migrate L2 links', async (t) => {
  const f = fixture(t);
  const target = await makeL1(f, 'merge-target', 'personal', [], personal, '目标记忆。');
  const source = await makeL1(f, 'merge-source', 'personal', [], personal, '来源记忆。');
  f.l2.enqueue({ id: 'before-merge', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'before-merge',
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: item.memory.content,
          summary: '摘要',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  const before = f.l2
    .listMemories({ ownerSpaceId: 'personal' }, personal)
    .find((memory) => memory.l1Ids.includes(source.memory.id));
  assert.ok(before);

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

  const updated = f.l2.getMemory(before.id, personal);
  assert.deepEqual(updated.l1Ids, [target.memory.id]);
  assert.equal(updated.needsUpdate, true);
  const changes = f.l2.listChanges({ ownerSpaceId: 'personal' }, personal);
  assert.ok(
    changes.some(
      (change) =>
        change.l1Id === source.memory.id && change.kind === 'merged' && change.state === 'processed'
    )
  );
  assert.ok(
    changes.some(
      (change) =>
        change.l1Id === target.memory.id &&
        change.kind === 'content_changed' &&
        change.state === 'pending'
    )
  );
});

test('L2 scope narrowing removes lost spaces and marks the memory for update', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const { memory: l1 } = await makeL1(f, 'scope-l1', project.id, ['personal'], both, '项目记忆。');
  f.l2.enqueue({ id: 'scope-l2', ownerSpaceId: project.id }, both);
  await f.l2.run(
    'scope-l2',
    {
      generate: async ({ changes }) => ({
        results: changes.map((item) => ({
          action: 'create',
          title: '项目上下文',
          summary: '摘要',
          body: item.memory.content,
          l1Ids: [item.memory.id],
        })),
        uncoveredL1Ids: [],
      }),
    },
    both
  );
  const [l2] = f.l2.listMemories({ ownerSpaceId: project.id }, both);
  assert.deepEqual(l2.relatedSpaceIds, ['personal']);

  const raw = new Database(f.databasePath);
  raw
    .prepare('DELETE FROM memory_l1_space_links WHERE memory_id=? AND space_id=?')
    .run(l1.id, 'personal');
  raw.close();
  const { invalidateL2ForScopeChange } = require(
    path.join(f.root, 'dist/db/memory/l2-invalidation')
  );
  f.db.createAdapter((orm) => invalidateL2ForScopeChange(orm, l1.id, new Date().toISOString()));

  const narrowed = f.l2.getMemory(l2.id, both);
  assert.deepEqual(narrowed.relatedSpaceIds, []);
  assert.equal(narrowed.needsUpdate, true);
  assert.equal(f.l2.recall({ query: '项目', anchoredSpaceIds: ['personal'] }, both).length, 0);
  assert.equal(f.l2.recall({ query: '项目', anchoredSpaceIds: [project.id] }, both).length, 1);
});

for (const api of ['chat', 'responses']) {
  test(`L2 ${api} adapter sends one structured synthesis request`, async (t) => {
    const f = fixture(t);
    const { memory: l1 } = await makeL1(
      f,
      `l2-api-${api}`,
      'personal',
      [],
      personal,
      '阿岚喜欢拿铁。'
    );
    f.l2.enqueue({ id: `l2-api-${api}`, ownerSpaceId: 'personal' }, personal);
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
        assert.equal(format.name, 'pmem_l2_memories');
        assert.equal(format.strict, true);
        const system = api === 'chat' ? request.messages[0].content : request.input[0].content;
        assert.match(system, /untrusted data/);
        assert.match(system, /uncoveredL1Ids/);
        const user = JSON.parse(
          api === 'chat' ? request.messages[1].content : request.input[1].content
        );
        assert.equal(user.ownerSpaceId, 'personal');
        assert.equal(user.changedL1[0].memory.id, l1.id);
        assert.deepEqual(user.candidateL2, []);
        const content = JSON.stringify({
          results: [
            {
              action: 'create',
              l2Id: null,
              title: '阿岚',
              summary: '角色',
              body: '阿岚喜欢拿铁。',
              l1Ids: [l1.id],
            },
          ],
          uncoveredL1Ids: [],
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
    assert.equal((await f.l2.run(`l2-api-${api}`, model, personal)).state, 'succeeded');
    assert.equal(f.l2.getJob(`l2-api-${api}`, personal).promptVersion, 'l2-v2');
    assert.equal(calls, 1);
    assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, personal).length, 1);
  });
}

test('L2 supersede replaces contradicted evidence without deleting the old L1', async (t) => {
  const f = fixture(t);
  const old = await makeL1(f, 'l1-old', 'personal', [], personal, '我的 5K 个人最好成绩是 27:12。');
  f.l2.recordChange({ l1Id: old.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-old', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'l2-old',
    {
      generate: async () => ({
        results: [
          {
            action: 'create',
            title: '5K 个人最好成绩',
            summary: '跑步记录',
            body: '个人最好成绩是 27:12。',
            l1Ids: [old.memory.id],
          },
        ],
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  const [before] = f.l2.listMemories({ ownerSpaceId: 'personal' }, personal);

  const current = await makeL1(
    f,
    'l1-current',
    'personal',
    [],
    personal,
    '我的 5K 个人最好成绩更新为 25:50。'
  );
  f.l2.recordChange({ l1Id: current.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'l2-current', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'l2-current',
    {
      generate: async ({ changes, candidates }) => {
        assert.equal(changes.length, 1);
        assert.equal(candidates[0].memory.id, before.id);
        return {
          results: [
            {
              action: 'update',
              l2Id: before.id,
              supersede: true,
              title: '5K 个人最好成绩',
              summary: '跑步记录',
              body: '个人最好成绩是 25:50。',
              l1Ids: [current.memory.id],
            },
          ],
          uncoveredL1Ids: [],
        };
      },
    },
    personal
  );

  const after = f.l2.getMemory(before.id, personal);
  assert.equal(after.body, '个人最好成绩是 25:50。');
  assert.deepEqual(after.l1Ids, [current.memory.id]);
  assert.deepEqual(after.sourceIds, [current.source.id]);
  assert.ok(f.l1.getMemory(old.memory.id, personal));
});

test('a replacement judgment creates current L2 and supersedes the old one', async (t) => {
  const f = fixture(t);
  const old = await makeL1(f, 'jev-old', 'personal', [], personal, '我的 5K 最好成绩是 27:12。');
  f.l2.recordChange({ l1Id: old.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'jev-l2-old', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'jev-l2-old',
    {
      generate: async () => ({
        results: [
          {
            action: 'create',
            title: '5K 个人最好成绩',
            summary: '跑步记录',
            body: '我的 5K 最好成绩是 27:12。',
            l1Ids: [old.memory.id],
          },
        ],
        uncoveredL1Ids: [],
      }),
    },
    personal
  );
  const [before] = f.l2.listMemories({ ownerSpaceId: 'personal' }, personal);

  const current = await makeL1(
    f,
    'jev-current',
    'personal',
    [],
    personal,
    '我的 5K 最好成绩更新为 25:50。'
  );
  f.l2.recordChange({ l1Id: current.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'jev-l2-current', ownerSpaceId: 'personal' }, personal);

  const l2 = f.assembleL2(f.db, {
    judge: {
      model: 'test-jev',
      judge: async (input) => {
        assert.match(input.current.body, /27:12/);
        assert.deepEqual(
          input.changes.map((change) => change.id),
          [current.memory.id]
        );
        return input.changes.map((change) => ({
          changedL1Id: change.id,
          type: 'replacement',
          confidence: 0.98,
        }));
      },
    },
  });
  await l2.run(
    'jev-l2-current',
    {
      generate: async ({ changes, candidates }) => {
        assert.equal(changes.length, 1);
        assert.equal(candidates.length, 0);
        return {
          results: [
            {
              action: 'create',
              title: '5K 个人最好成绩',
              summary: '当前跑步记录',
              body: '我的 5K 最好成绩是 25:50。',
              l1Ids: [current.memory.id],
            },
          ],
          uncoveredL1Ids: [],
        };
      },
    },
    personal
  );

  const memories = l2.listMemories({ ownerSpaceId: 'personal' }, personal);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].body, '我的 5K 最好成绩是 25:50。');
  assert.deepEqual(memories[0].l1Ids, [current.memory.id]);
  const superseded = l2.getMemory(before.id, personal);
  assert.equal(superseded.visible, false);
  assert.equal(superseded.supersededBy, memories[0].id);
  assert.equal(l2.getJob('jev-l2-current', personal).state, 'succeeded');
});

test('a failed change judgment fails the L2 job instead of silently merging', async (t) => {
  const f = fixture(t);
  const old = await makeL1(f, 'judge-fail-old', 'personal', [], personal, '旧事实。');
  f.l2.recordChange({ l1Id: old.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'judge-fail-old-job', ownerSpaceId: 'personal' }, personal);
  await f.l2.run(
    'judge-fail-old-job',
    {
      generate: async () => ({
        results: [
          {
            action: 'create',
            title: '旧事实',
            summary: '摘要',
            body: '旧事实。',
            l1Ids: [old.memory.id],
          },
        ],
        uncoveredL1Ids: [],
      }),
    },
    personal
  );

  const current = await makeL1(f, 'judge-fail-current', 'personal', [], personal, '新事实。');
  f.l2.recordChange({ l1Id: current.memory.id, kind: 'created' }, personal);
  f.l2.enqueue({ id: 'judge-fail-current-job', ownerSpaceId: 'personal' }, personal);
  let called = false;
  const l2 = f.assembleL2(f.db, {
    judge: {
      model: 'test-jev',
      judge: async () => {
        throw new Error('decision unavailable');
      },
    },
  });
  await assert.rejects(
    l2.run(
      'judge-fail-current-job',
      {
        generate: async () => {
          called = true;
          throw new Error('must not run');
        },
      },
      personal
    ),
    code('L2_DECISION_FAILED')
  );
  assert.equal(called, false);
  assert.equal(l2.getJob('judge-fail-current-job', personal).state, 'unknown');
  assert.equal(
    l2
      .listChanges({ ownerSpaceId: 'personal' }, personal)
      .find((change) => change.l1Id === current.memory.id).state,
    'failed'
  );
});
