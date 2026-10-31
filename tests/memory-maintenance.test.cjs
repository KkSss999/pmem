'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-maintenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const dir of ['sdk', 'server', 'db', 'domain', 'service', 'other'])
    fs.cpSync(path.join(__dirname, '..', 'dist', dir), path.join(root, 'dist', dir), {
      recursive: true,
    });
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
  const { assembleL1Scheduler } = require(path.join(root, 'dist/server/l1-scheduler'));
  const { L1ModelError } = require(path.join(root, 'dist/domain/memory/l1'));
  const { OpenAIExtractionModel } = require(path.join(root, 'dist/other/models/openai'));
  const databasePath = path.join(root, 'memory.sqlite');
  const db = OwnedDatabase.create(databasePath);
  return {
    root,
    databasePath,
    db,
    OwnedDatabase,
    assembleMemory,
    assembleL1,
    assembleL1Maintenance,
    assembleL1Scheduler,
    L1ModelError,
    OpenAIExtractionModel,
    memory: assembleMemory(db),
    l1: assembleL1(db),
    maintenance: assembleL1Maintenance(db),
  };
}

const personal = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const code = (name) => (error) => error?.code === name;
const keep = (memoryId, action = 'keep') => ({
  memoryId,
  action,
  targetId: null,
  content: null,
  abstraction: null,
  cues: [],
});
const merge = (memoryId, targetId) => ({
  memoryId,
  action: 'merge',
  targetId,
  content: '阿岚喜欢拿铁，住在北城。',
  abstraction: '阿岚的偏好和居所',
  cues: ['阿岚', '拿铁', '北城'],
});
async function make(f, jobId, spaceId, relatedSpaceIds, access, content, time) {
  const source = f.memory.appendL0(
    { spaceId, role: 'user', content: `source ${jobId}` },
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
            abstraction: '阿岚的偏好',
            cues: ['阿岚', '拿铁'],
            sourceIds: [source.id],
            relatedSpaceIds,
          },
        ],
      }),
    },
    access
  );
  const memory = f.l1.getJobMemories(jobId, access)[0];
  const raw = new Database(f.databasePath);
  raw.prepare('UPDATE memory_l1 SET created_at = ? WHERE id = ?').run(time, memory.id);
  raw.close();
  return { source, memory };
}
const oldTime = '2025-01-01T00:00:00.000Z';
const newTime = '2026-01-01T00:00:00.000Z';

test('cross-space merge preserves full scope, both sources and both job results', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const old = await make(
    f,
    'old',
    'personal',
    [project.id],
    both,
    '阿岚喜欢拿铁。',
    '2028-01-01T00:00:00.000Z'
  );
  const newer = await make(
    f,
    'new',
    project.id,
    ['personal'],
    both,
    '阿岚喜欢拿铁，住在北城。',
    newTime
  );
  let calls = 0;
  const work = f.maintenance.startBatch(
    {
      review: async ({ cases }) => {
        calls++;
        assert.equal(cases.length, 1);
        assert.deepEqual(Object.keys(cases[0].memory).sort(), [
          'abstraction',
          'content',
          'cues',
          'id',
        ]);
        assert.equal(cases[0].memory.id, newer.memory.id);
        assert.equal(cases[0].candidates[0].id, old.memory.id);
        return { decisions: [merge(newer.memory.id, old.memory.id)] };
      },
    },
    both
  );
  assert.ok(work);
  await work;
  assert.equal(calls, 1);
  const result = f.l1.getJobMemories('old', both)[0];
  assert.equal(result.id, old.memory.id);
  assert.equal(result.spaceId, 'personal');
  assert.deepEqual(result.relatedSpaceIds, [project.id]);
  assert.deepEqual([...result.sourceIds].sort(), [old.source.id, newer.source.id].sort());
  assert.deepEqual(
    f.l1.getJobMemories('new', both).map((x) => x.id),
    [old.memory.id]
  );
  assert.equal(f.maintenance.getTask(newer.memory.id, both).outcome, 'merge');
  assert.equal(f.maintenance.getTask(newer.memory.id, both).resultMemoryId, old.memory.id);
  assert.equal(f.l1.getMemory(newer.memory.id, both), undefined);
  assert.equal(f.memory.getL0(old.source.id, both).content, 'source old');
  assert.equal(f.memory.getL0(newer.source.id, both).content, 'source new');
  const projectOnly = {
    readableSpaceIds: [project.id],
    writableSpaceIds: [project.id],
    canManageSpaces: false,
  };
  const shared = f.l1.getJobMemories('new', projectOnly)[0];
  assert.equal(shared.id, old.memory.id);
  assert.deepEqual(shared.sourceIds, [newer.source.id]);
  assert.equal(shared.sourcesComplete, false);
  assert.equal(f.memory.getL0(old.source.id, projectOnly), undefined);
  assert.equal(f.l1.searchIndexStatus(both), 'healthy');
  assert.equal(
    f.l1.recall({ query: '北城', anchoredSpaceIds: ['personal'] }, both)[0].id,
    old.memory.id
  );
  f.db.close();
});

test('different sharing scopes or missing owner write permission never merge', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const old = await make(f, 'old', project.id, ['personal'], both, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(
    f,
    'new',
    'personal',
    [project.id],
    both,
    '阿岚喜欢拿铁并住在北城。',
    newTime
  );
  let calls = 0;
  const model = {
    review: async () => {
      calls++;
      return { decisions: [] };
    },
  };
  await f.maintenance.startBatch(model, personal);
  assert.equal(calls, 0);
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).outcome, 'no_candidates');
  assert.ok(f.l1.getMemory(old.memory.id, both));
  assert.ok(f.l1.getMemory(newer.memory.id, both));
  const third = await make(
    f,
    'third',
    'personal',
    [],
    both,
    '阿岚喜欢拿铁。',
    '2026-02-01T00:00:00.000Z'
  );
  await f.maintenance.startBatch(model, both);
  assert.equal(calls, 0);
  assert.equal(f.maintenance.getTask(third.memory.id, both).outcome, 'no_candidates');
  assert.ok(f.l1.getMemory(third.memory.id, both));
  f.db.close();
});

test('revoking either space write access during the model call prevents merge', async (t) => {
  const f = fixture(t);
  const project = f.memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const old = await make(f, 'old', 'personal', [project.id], both, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(
    f,
    'new',
    project.id,
    ['personal'],
    both,
    '阿岚喜欢拿铁并住北城。',
    newTime
  );
  let release;
  let cases;
  const pending = f.maintenance.startBatch(
    {
      review: (input) => {
        cases = input.cases;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    both
  );
  both.writableSpaceIds = ['personal'];
  release({ decisions: [merge(cases[0].memory.id, old.memory.id)] });
  await assert.rejects(pending, code('MODEL_FAILED'));
  assert.equal(f.maintenance.getTask(newer.memory.id, both).failureCode, 'ACCESS_DENIED');
  assert.ok(f.l1.getMemory(old.memory.id, both));
  assert.ok(f.l1.getMemory(newer.memory.id, both));
  f.db.close();
});

test('L1 and its maintenance task are created atomically', async (t) => {
  const f = fixture(t);
  const source = f.memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原文' },
    personal
  ).message;
  f.l1.enqueue({ id: 'atomic', sourceIds: [source.id] }, personal);
  const raw = new Database(f.databasePath);
  raw.exec(
    "CREATE TRIGGER test_maintenance_insert_failure BEFORE INSERT ON memory_l1_maintenance_tasks BEGIN SELECT RAISE(ABORT, 'blocked'); END"
  );
  const model = {
    extract: async () => ({
      memories: [
        {
          content: '记忆',
          abstraction: '主题',
          cues: [],
          sourceIds: [source.id],
          relatedSpaceIds: [],
        },
      ],
    }),
  };
  await assert.rejects(f.l1.run('atomic', model, personal));
  assert.equal(raw.prepare('SELECT count(*) n FROM memory_l1').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) n FROM memory_l1_job_results').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) n FROM memory_l1_maintenance_tasks').get().n, 0);
  assert.equal(f.memory.getL0(source.id, personal).content, '原文');
  raw.exec('DROP TRIGGER test_maintenance_insert_failure');
  raw.close();
  f.l1.markInterrupted('atomic', personal);
  f.l1.retry('atomic', personal);
  await f.l1.run('atomic', model, personal);
  const result = f.l1.getJobMemories('atomic', personal)[0];
  assert.equal(f.maintenance.getTask(result.id, personal).state, 'pending');
  f.db.close();
});

test('uncertain model decisions preserve both memories and invalid decisions fail safely', async (t) => {
  const f = fixture(t);
  const old = await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  await f.maintenance.startBatch(
    {
      review: async ({ cases }) => ({
        decisions: cases.map((item) => keep(item.memory.id, 'uncertain')),
      }),
    },
    personal
  );
  assert.ok(f.l1.getMemory(old.memory.id, personal));
  assert.ok(f.l1.getMemory(newer.memory.id, personal));
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).outcome, 'uncertain');
  const third = await make(
    f,
    'third',
    'personal',
    [],
    personal,
    '阿岚拿铁偏好。',
    '2027-01-01T00:00:00.000Z'
  );
  await assert.rejects(
    f.maintenance.startBatch(
      { review: async () => ({ decisions: [merge(third.memory.id, 'invented')] }) },
      personal
    ),
    code('MODEL_FAILED')
  );
  assert.equal(f.maintenance.getTask(third.memory.id, personal).state, 'failed');
  assert.equal(
    f.maintenance.getTask(third.memory.id, personal).failureCode,
    'MODEL_OUTPUT_INVALID'
  );
  assert.ok(f.l1.getMemory(third.memory.id, personal));
  f.db.close();
});

test('unknown model effects stay observable and require explicit retry', async (t) => {
  const f = fixture(t);
  await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  await assert.rejects(
    f.maintenance.startBatch(
      {
        review: async () => {
          throw new f.L1ModelError('API_TRANSPORT', 'unknown', 'unavailable');
        },
      },
      personal
    ),
    code('MODEL_FAILED')
  );
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'unknown');
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).failureCode, 'API_TRANSPORT');
  assert.deepEqual(
    f.maintenance
      .listTasks({ spaceId: 'personal', state: 'unknown' }, personal)
      .tasks.map((task) => task.memoryId)
      .sort(),
    [f.l1.getJobMemories('old', personal)[0].id, newer.memory.id].sort()
  );
  assert.throws(
    () => f.maintenance.listTasks({ spaceId: 'personal' }, { ...personal, readableSpaceIds: [] }),
    code('ACCESS_DENIED')
  );
  const project = f.memory.createSpace('Independent', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const independent = await make(f, 'independent', project.id, [], both, '独立空间内容。', newTime);
  await f.maintenance.startBatch(
    {
      review: async () => {
        throw new Error('unexpected model call');
      },
    },
    both
  );
  assert.equal(f.maintenance.getTask(independent.memory.id, both).outcome, 'no_candidates');
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'unknown');
  assert.equal(
    f.maintenance.startBatch({ review: async () => ({ decisions: [] }) }, personal),
    undefined
  );
  for (const id of [f.l1.getJobMemories('old', personal)[0].id, newer.memory.id])
    f.maintenance.retry(id, personal);
  await f.maintenance.startBatch(
    { review: async ({ cases }) => ({ decisions: cases.map((item) => keep(item.memory.id)) }) },
    personal
  );
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'succeeded');
  f.db.close();
});

test('maintenance is read-only when the database is opened read-only', (t) => {
  const f = fixture(t);
  f.db.close();
  const readOnly = f.OwnedDatabase.open(f.databasePath, true);
  const maintenance = f.assembleL1Maintenance(readOnly);
  assert.throws(
    () => maintenance.startBatch({ review: async () => ({ decisions: [] }) }, personal),
    code('READ_ONLY')
  );
  assert.throws(() => maintenance.retry('missing', personal), code('READ_ONLY'));
  assert.deepEqual(maintenance.listTasks({ spaceId: 'personal' }, personal), { tasks: [] });
  readOnly.close();
});

test('index failures remain visible and can be retried after recovery', async (t) => {
  const f = fixture(t);
  const item = await make(f, 'one', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const raw = new Database(f.databasePath);
  raw.exec('DROP TABLE memory_l1_search');
  let calls = 0;
  await assert.rejects(
    f.maintenance.startBatch(
      {
        review: async () => {
          calls++;
          return { decisions: [] };
        },
      },
      personal
    ),
    code('MODEL_FAILED')
  );
  assert.equal(calls, 0);
  assert.equal(f.maintenance.getTask(item.memory.id, personal).state, 'failed');
  assert.equal(f.maintenance.getTask(item.memory.id, personal).failureCode, 'INDEX_MISSING');
  f.l1.rebuildSearchIndex(personal);
  f.maintenance.retry(item.memory.id, personal);
  await f.maintenance.startBatch(
    {
      review: async () => {
        calls++;
        return { decisions: [] };
      },
    },
    personal
  );
  assert.equal(f.maintenance.getTask(item.memory.id, personal).outcome, 'no_candidates');
  raw.close();
  f.db.close();
});

test('maintenance migration backfills tasks and job results and rolls back safely on error', async (t) => {
  const f = fixture(t);
  f.db.close();
  const journalPath = path.join(f.root, 'migrations/memory/meta/_journal.json');
  const journalText = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(journalText);
  journal.entries = journal.entries.slice(0, 5);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const previousPath = path.join(f.root, 'previous.sqlite');
  const old = f.OwnedDatabase.create(previousPath);
  const oldMemory = f.assembleMemory(old);
  const oldL1 = f.assembleL1(old);
  const source = oldMemory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原始内容' },
    personal
  ).message;
  oldL1.enqueue({ id: 'old-job', sourceIds: [source.id] }, personal);
  old.close();
  const legacy = new Database(previousPath);
  legacy
    .prepare(
      "INSERT INTO memory_l1(id, job_id, space_id, content, abstraction, maintenance_status, created_at) VALUES ('old-memory', 'old-job', 'personal', '原始 L1', '主题', 'pending', '2026-01-01T00:00:00Z')"
    )
    .run();
  legacy
    .prepare("INSERT INTO memory_l1_sources(memory_id, l0_id) VALUES ('old-memory', ?)")
    .run(source.id);
  legacy.prepare("INSERT INTO memory_l1_cues(memory_id, cue) VALUES ('old-memory', '检索')").run();
  legacy.prepare("UPDATE memory_l1_jobs SET state='succeeded' WHERE id='old-job'").run();
  legacy.close();
  fs.writeFileSync(journalPath, journalText);
  const migrationPath = path.join(f.root, 'migrations/memory/0005_l1_maintenance.sql');
  const valid = fs.readFileSync(migrationPath, 'utf8');
  fs.appendFileSync(migrationPath, '\n--> statement-breakpoint\nINVALID SQL;\n');
  await assert.rejects(
    f.OwnedDatabase.migrate(previousPath, path.join(f.root, 'failed-backup.sqlite'))
  );
  const before = new Database(previousPath, { readonly: true });
  assert.equal(before.prepare('SELECT count(*) n FROM memory_l1').get().n, 1);
  assert.equal(before.prepare('SELECT count(*) n FROM memory_l1_sources').get().n, 1);
  assert.equal(
    before
      .prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_l1_maintenance_tasks'")
      .get().n,
    0
  );
  before.close();
  fs.writeFileSync(migrationPath, valid);
  const backupPath = path.join(f.root, 'before-maintenance.sqlite');
  assert.equal((await f.OwnedDatabase.migrate(previousPath, backupPath)).migrationsApplied, 5);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.prepare('SELECT content FROM memory_l0_messages').get().content, '原始内容');
  backup.close();
  const upgraded = f.OwnedDatabase.open(previousPath, false);
  const result = f.assembleL1(upgraded).getJobMemories('old-job', personal)[0];
  assert.equal(result.content, '原始 L1');
  assert.deepEqual(result.sourceIds, [source.id]);
  assert.equal(f.assembleL1Maintenance(upgraded).getTask(result.id, personal).state, 'pending');
  upgraded.close();
});

test('overlapping batch merges are re-evaluated and keep every job and source', async (t) => {
  const f = fixture(t);
  const first = await make(f, 'first', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const second = await make(
    f,
    'second',
    'personal',
    [],
    personal,
    '阿岚喜欢拿铁，住北城。',
    newTime
  );
  const third = await make(
    f,
    'third',
    'personal',
    [],
    personal,
    '阿岚喜欢拿铁，在花店工作。',
    '2027-01-01T00:00:00.000Z'
  );
  const model = {
    review: async ({ cases }) => ({
      decisions: cases.map((item) => merge(item.memory.id, first.memory.id)),
    }),
  };
  await f.maintenance.startBatch(model, personal);
  assert.equal(f.maintenance.getTask(second.memory.id, personal).outcome, 'merge');
  assert.equal(f.maintenance.getTask(third.memory.id, personal).state, 'pending');
  await f.maintenance.startBatch(model, personal);
  assert.equal(f.maintenance.getTask(third.memory.id, personal).outcome, 'merge');
  const result = f.l1.getJobMemories('first', personal)[0];
  assert.deepEqual(
    [...result.sourceIds].sort(),
    [first.source.id, second.source.id, third.source.id].sort()
  );
  assert.equal(f.l1.getJobMemories('second', personal)[0].id, result.id);
  assert.equal(f.l1.getJobMemories('third', personal)[0].id, result.id);
  f.db.close();
});

test('same-scope workers serialize and stale candidate changes cause a fresh decision', async (t) => {
  const f = fixture(t);
  const old = await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  let release;
  let caseData;
  const running = f.maintenance.startBatch(
    {
      review: ({ cases }) => {
        caseData = cases;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    personal
  );
  const secondDb = f.OwnedDatabase.open(f.databasePath, false);
  const secondWorker = f.assembleL1Maintenance(secondDb);
  assert.equal(
    secondWorker.startBatch({ review: async () => ({ decisions: [] }) }, personal),
    undefined
  );
  const raw = new Database(f.databasePath);
  raw
    .prepare('UPDATE memory_l1 SET content = ? WHERE id = ?')
    .run('阿岚喜欢拿铁和抹茶。', old.memory.id);
  raw.close();
  release({ decisions: [merge(caseData[0].memory.id, old.memory.id)] });
  await running;
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'pending');
  assert.equal(f.l1.getMemory(old.memory.id, personal).content, '阿岚喜欢拿铁和抹茶。');
  assert.ok(f.l1.getMemory(newer.memory.id, personal));
  await secondWorker.startBatch(
    {
      review: async ({ cases }) => ({
        decisions: cases.map((item) => keep(item.memory.id, 'uncertain')),
      }),
    },
    personal
  );
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).outcome, 'uncertain');
  secondDb.close();
  f.db.close();
});

test('changing the source memory during review releases the batch for a new judgment', async (t) => {
  const f = fixture(t);
  const old = await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  let release;
  let cases;
  const first = f.maintenance.startBatch(
    {
      review: (input) => {
        cases = input.cases;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    personal
  );
  const raw = new Database(f.databasePath);
  raw
    .prepare('UPDATE memory_l1 SET content = ? WHERE id = ?')
    .run('阿岚不再喜欢拿铁。', newer.memory.id);
  raw.close();
  release({ decisions: [merge(cases[0].memory.id, old.memory.id)] });
  await first;
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'pending');
  assert.equal(f.l1.getMemory(newer.memory.id, personal).content, '阿岚不再喜欢拿铁。');
  assert.equal(f.l1.getMemory(old.memory.id, personal).content, '阿岚喜欢拿铁。');
  await f.maintenance.startBatch(
    {
      review: async ({ cases: fresh }) => ({
        decisions: fresh.map((item) => keep(item.memory.id, 'uncertain')),
      }),
    },
    personal
  );
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).outcome, 'uncertain');
  f.db.close();
});

test('interrupted claims fence a late model response after explicit retry', async (t) => {
  const f = fixture(t);
  const old = await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  let release;
  let cases;
  const stale = f.maintenance.startBatch(
    {
      review: (input) => {
        cases = input.cases;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    personal
  );
  f.maintenance.markInterrupted(old.memory.id, personal);
  f.maintenance.markInterrupted(newer.memory.id, personal);
  f.maintenance.retry(old.memory.id, personal);
  f.maintenance.retry(newer.memory.id, personal);
  await f.maintenance.startBatch(
    {
      review: async ({ cases: current }) => ({
        decisions: current.map((item) => keep(item.memory.id)),
      }),
    },
    personal
  );
  release({ decisions: [merge(cases[0].memory.id, old.memory.id)] });
  await assert.rejects(stale, code('MODEL_FAILED'));
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'succeeded');
  assert.ok(f.l1.getMemory(newer.memory.id, personal));
  f.db.close();
});

test('a failed merge transaction leaves memories, sources and results intact', async (t) => {
  const f = fixture(t);
  const old = await make(f, 'old', 'personal', [], personal, '阿岚喜欢拿铁。', oldTime);
  const newer = await make(f, 'new', 'personal', [], personal, '阿岚喜欢拿铁并住北城。', newTime);
  const raw = new Database(f.databasePath);
  raw.exec(
    "CREATE TRIGGER test_merge_failure BEFORE DELETE ON memory_l1 BEGIN SELECT RAISE(ABORT, 'blocked'); END"
  );
  const model = {
    review: async ({ cases }) => ({
      decisions: cases.map((item) => merge(item.memory.id, old.memory.id)),
    }),
  };
  await assert.rejects(f.maintenance.startBatch(model, personal), code('MODEL_FAILED'));
  assert.equal(f.l1.getMemory(old.memory.id, personal).content, '阿岚喜欢拿铁。');
  assert.equal(f.l1.getMemory(newer.memory.id, personal).content, '阿岚喜欢拿铁并住北城。');
  assert.deepEqual(f.l1.getJobMemories('old', personal)[0].sourceIds, [old.source.id]);
  assert.deepEqual(f.l1.getJobMemories('new', personal)[0].sourceIds, [newer.source.id]);
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).state, 'unknown');
  raw.exec('DROP TRIGGER test_merge_failure');
  raw.close();
  f.maintenance.retry(old.memory.id, personal);
  f.maintenance.retry(newer.memory.id, personal);
  await f.maintenance.startBatch(model, personal);
  assert.equal(f.maintenance.getTask(newer.memory.id, personal).outcome, 'merge');
  assert.equal(f.l1.searchIndexStatus(personal), 'healthy');
  f.db.close();
});

test('automatic scheduler performs extraction and maintenance with one shared worker budget', async (t) => {
  const f = fixture(t);
  let reviews = 0;
  const model = {
    extract: async ({ messages }) => ({
      memories: [
        {
          content: '阿岚喜欢拿铁。',
          abstraction: '阿岚的偏好',
          cues: ['阿岚'],
          sourceIds: [messages[0].id],
          relatedSpaceIds: [],
        },
        {
          content: '阿岚喜欢拿铁，住在北城。',
          abstraction: '阿岚的偏好',
          cues: ['阿岚'],
          sourceIds: [messages[1].id],
          relatedSpaceIds: [],
        },
      ],
    }),
    review: async ({ cases }) => {
      reviews++;
      return { decisions: cases.map((item) => merge(item.memory.id, item.candidates[0].id)) };
    },
  };
  const scheduler = f.assembleL1Scheduler(f.db, model, personal);
  scheduler.start();
  assert.equal(scheduler.status().maintenanceEnabled, true);
  for (let i = 0; i < 10; i++)
    scheduler.capture({
      spaceId: 'personal',
      role: 'user',
      content: `message ${i}`,
      source: 'agent',
      sessionId: 'session',
    });
  const deadline = Date.now() + 3000;
  while (!reviews || scheduler.status().activeJobIds.length) {
    if (Date.now() > deadline) throw new Error('scheduler timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const job = f.l1.listJobs({ spaceId: 'personal', state: 'succeeded' }, personal).jobs[0];
  assert.equal(f.l1.getJobMemories(job.id, personal).length, 1);
  assert.equal(reviews, 1);
  await scheduler.stop();
  f.db.close();
});

for (const provider of ['openai', 'deepseek']) {
  for (const api of ['chat', 'responses']) {
    test(`${provider} ${api} maintenance sends one structured model request`, async (t) => {
      const f = fixture(t);
      let calls = 0;
      const content = JSON.stringify({ decisions: [keep('new')] });
      const model = new f.OpenAIExtractionModel({
        provider,
        api,
        apiKey: 'test',
        model: 'test',
        fetch: async (_url, options) => {
          calls++;
          const request = JSON.parse(options.body);
          const format = api === 'chat' ? request.response_format : request.text.format;
          if (provider === 'deepseek' && api === 'chat') assert.equal(format.type, 'json_object');
          else
            assert.equal(
              api === 'chat' ? format.json_schema.name : format.name,
              'pmem_l1_maintenance'
            );
          return Response.json(
            api === 'chat'
              ? { choices: [{ finish_reason: 'stop', message: { content } }] }
              : {
                  status: 'completed',
                  output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }],
                }
          );
        },
      });
      const response = await model.review({
        cases: [
          {
            memory: { id: 'new', content: 'x', abstraction: 'x', cues: [] },
            candidates: [{ id: 'old', content: 'x', abstraction: 'x', cues: [] }],
          },
        ],
      });
      assert.deepEqual(response, { decisions: [keep('new')] });
      assert.equal(calls, 1);
      f.db.close();
    });
  }
}
