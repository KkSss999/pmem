'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-l1-'));
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
  const { OpenAIExtractionModel } = require(path.join(root, 'dist/other/models/openai'));
  const { L1ModelError } = require(path.join(root, 'dist/domain/memory/l1'));
  const databasePath = path.join(root, 'memory.sqlite');
  const db = OwnedDatabase.create(databasePath);
  return {
    root,
    OwnedDatabase,
    assembleMemory,
    assembleL1,
    OpenAIExtractionModel,
    L1ModelError,
    databasePath,
    db,
    memory: assembleMemory(db),
    l1: assembleL1(db),
  };
}

const personal = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const code = (expected) => (error) => error && error.code === expected;
const draft = (sourceIds, extra = {}) => ({
  content: '记忆内容',
  abstraction: '主题',
  cues: ['检索线索'],
  sourceIds,
  relatedSpaceIds: [],
  ...extra,
});

test('keyword recall uses content and cues within linked spaces while protecting L0', async (t) => {
  const { db, memory, l1, OwnedDatabase, assembleL1, databasePath } = fixture(t);
  const project = memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const source = memory.appendL0(
    { spaceId: project.id, role: 'user', content: '项目原文' },
    both
  ).message;
  l1.enqueue({ id: 'search', sourceIds: [source.id], relatedSpaceIds: ['personal'] }, both);
  await l1.run(
    'search',
    {
      extract: async () => ({
        memories: [
          draft([source.id], {
            content: '小说角色阿岚居住在北城',
            abstraction: '虚构角色背景',
            cues: ['纸舟设定', 'TypeScript'],
            relatedSpaceIds: ['personal'],
          }),
          draft([source.id], { content: '北城的私有记忆', abstraction: '其他', cues: [] }),
        ],
      }),
    },
    both
  );
  const search = (query, access = personal, anchoredSpaceIds = ['personal']) =>
    l1.recall({ query, anchoredSpaceIds }, access);
  const [linked] = search('北城');
  assert.equal(search('北城').length, 1);
  assert.match(linked.content, /阿岚/);
  assert.deepEqual(linked.sourceIds, []);
  assert.equal(linked.sourcesComplete, false);
  assert.equal(linked.maintenanceStatus, 'pending');
  assert.equal(memory.getL0(source.id, personal), undefined);
  assert.equal(search('纸舟设定')[0].id, linked.id);
  assert.equal(search('TypeScript')[0].id, linked.id);
  assert.equal(search('虚构角色')[0].id, linked.id);
  assert.equal(search('北城', both, [project.id]).length, 2);
  assert.throws(() => search('北城', personal, [project.id]), code('ACCESS_DENIED'));
  assert.equal(search('没有任何匹配的术语').length, 0);
  db.close();
  const readonly = OwnedDatabase.open(databasePath, true);
  assert.equal(
    assembleL1(readonly).recall({ query: '纸舟设定', anchoredSpaceIds: ['personal'] }, personal)[0]
      .id,
    linked.id
  );
  readonly.close();
});

test('search migration backfills memories, preserves backups and rolls back on error', async (t) => {
  const { root, db, OwnedDatabase, assembleMemory, assembleL1 } = fixture(t);
  db.close();
  const journalPath = path.join(root, 'migrations/memory/meta/_journal.json');
  const originalJournal = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(originalJournal);
  journal.entries = journal.entries.slice(0, 3);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const databasePath = path.join(root, 'before-search.sqlite');
  const oldDb = OwnedDatabase.create(databasePath);
  const source = assembleMemory(oldDb).appendL0(
    { spaceId: 'personal', role: 'user', content: '原始消息' },
    personal
  ).message;
  const oldL1 = assembleL1(oldDb);
  oldL1.enqueue({ id: 'before-search', sourceIds: [source.id] }, personal);
  oldDb.close();
  const legacy = new (require('better-sqlite3'))(databasePath);
  legacy
    .prepare(
      "INSERT INTO memory_l1(id, job_id, space_id, content, abstraction, maintenance_status, created_at) VALUES ('old-memory', 'before-search', 'personal', '记忆内容', '主题', 'pending', '2026-01-01T00:00:00Z')"
    )
    .run();
  legacy
    .prepare("INSERT INTO memory_l1_sources(memory_id, l0_id) VALUES ('old-memory', ?)")
    .run(source.id);
  legacy
    .prepare("INSERT INTO memory_l1_cues(memory_id, cue) VALUES ('old-memory', '特有的检索线索')")
    .run();
  legacy.prepare("UPDATE memory_l1_jobs SET state='succeeded' WHERE id='before-search'").run();
  legacy.close();
  fs.writeFileSync(journalPath, originalJournal);
  const migrationPath = path.join(root, 'migrations/memory/0003_l1_search.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  fs.appendFileSync(migrationPath, '\n--> statement-breakpoint\nINVALID SQL;\n');
  await assert.rejects(
    OwnedDatabase.migrate(databasePath, path.join(root, 'failed-backup.sqlite'))
  );
  const Database = require('better-sqlite3');
  const check = new Database(databasePath, { readonly: true });
  assert.equal(check.prepare('SELECT count(*) n FROM memory_l1').get().n, 1);
  assert.equal(
    check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='memory_l1_search'").get().n,
    0
  );
  check.close();
  fs.writeFileSync(migrationPath, migration);
  const backupPath = path.join(root, 'before-search-backup.sqlite');
  assert.equal((await OwnedDatabase.migrate(databasePath, backupPath)).migrationsApplied, 6);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.prepare('SELECT count(*) n FROM memory_l1').get().n, 1);
  backup.close();
  const upgraded = OwnedDatabase.open(databasePath, false);
  assert.equal(
    assembleL1(upgraded).recall({ query: '检索线索', anchoredSpaceIds: ['personal'] }, personal)
      .length,
    1
  );
  upgraded.close();
});

test('recall reflects committed index updates and reports an unavailable index', async (t) => {
  const { db, memory, l1, databasePath } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原文' },
    personal
  ).message;
  l1.enqueue({ id: 'index-sync', sourceIds: [source.id] }, personal);
  await l1.run(
    'index-sync',
    { extract: async () => ({ memories: [draft([source.id], { cues: ['oldmarker'] })] }) },
    personal
  );
  const id = l1.getJobMemories('index-sync', personal)[0].id;
  const Database = require('better-sqlite3');
  const connection = new Database(databasePath);
  connection.prepare('UPDATE memory_l1 SET content = ? WHERE id = ?').run('新关键词', id);
  connection.prepare('UPDATE memory_l1_cues SET cue = ? WHERE memory_id = ?').run('newmarker', id);
  assert.equal(
    l1.recall({ query: '新关键词', anchoredSpaceIds: ['personal'] }, personal).length,
    1
  );
  assert.equal(
    l1.recall({ query: 'newmarker', anchoredSpaceIds: ['personal'] }, personal).length,
    1
  );
  assert.equal(
    l1.recall({ query: 'oldmarker', anchoredSpaceIds: ['personal'] }, personal).length,
    0
  );
  connection.exec('DROP TABLE memory_l1_search');
  assert.throws(() => l1.recall({ query: '新关键词', anchoredSpaceIds: ['personal'] }, personal));
  connection.close();
  db.close();
});

test('index health detects drift and repairs it without changing memories or sources', async (t) => {
  const { db, memory, l1, databasePath, OwnedDatabase, assembleL1 } = fixture(t);
  const project = memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const sourceA = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原文一' },
    both
  ).message;
  const sourceB = memory.appendL0(
    { spaceId: project.id, role: 'assistant', content: '原文二' },
    both
  ).message;
  l1.enqueue(
    { id: 'index-repair', spaceId: 'personal', sourceIds: [sourceA.id, sourceB.id] },
    both
  );
  await l1.run(
    'index-repair',
    {
      extract: async () => ({
        memories: [
          draft([sourceA.id, sourceB.id], { content: '独特记忆', cues: ['独特线索', '第二线索'] }),
        ],
      }),
    },
    both
  );
  const before = l1.getJobMemories('index-repair', both);
  const recall = (query) => l1.recall({ query, anchoredSpaceIds: ['personal'] }, both);
  assert.equal(l1.searchIndexStatus(both), 'healthy');
  assert.deepEqual(recall('不存在的词语XYZ'), []);
  const raw = new (require('better-sqlite3'))(databasePath);
  for (const [index, mutate] of [
    () => raw.prepare('DELETE FROM memory_l1_search WHERE memory_id = ?').run(before[0].id),
    () =>
      raw
        .prepare('UPDATE memory_l1_search SET content = ? WHERE memory_id = ?')
        .run('过期的内容', before[0].id),
    () =>
      raw
        .prepare(
          'INSERT INTO memory_l1_search (memory_id, content, abstraction, cues) SELECT memory_id, content, abstraction, cues FROM memory_l1_search'
        )
        .run(),
    () => raw.exec('DROP TRIGGER memory_l1_search_cue_insert'),
    () =>
      raw.exec(
        'DROP TRIGGER memory_l1_search_cue_insert; CREATE TRIGGER memory_l1_search_cue_insert AFTER INSERT ON memory_l1_cues BEGIN SELECT 1; END'
      ),
  ].entries()) {
    mutate();
    assert.equal(l1.searchIndexStatus(both), 'stale', `mutation ${index}`);
    assert.throws(() => recall('不存在的词语XYZ'), code('INDEX_STALE'));
    assert.throws(() => recall('🧪'), code('INDEX_STALE'));
    if (index === 0) {
      const bytes = fs.readFileSync(databasePath);
      const brokenReadOnly = OwnedDatabase.open(databasePath, true);
      const reader = assembleL1(brokenReadOnly);
      assert.equal(reader.searchIndexStatus(both), 'stale');
      assert.throws(
        () => reader.recall({ query: '没有结果', anchoredSpaceIds: ['personal'] }, both),
        code('INDEX_STALE')
      );
      assert.throws(() => reader.rebuildSearchIndex(both), code('READ_ONLY'));
      brokenReadOnly.close();
      assert.deepEqual(fs.readFileSync(databasePath), bytes);
    }
    l1.rebuildSearchIndex(both);
    assert.equal(l1.searchIndexStatus(both), 'healthy');
    assert.equal(recall('独特线索')[0].id, before[0].id);
    assert.deepEqual(l1.getJobMemories('index-repair', both), before);
    assert.deepEqual(memory.getL0(sourceA.id, both), sourceA);
    assert.deepEqual(memory.getL0(sourceB.id, both), sourceB);
  }
  raw.exec('DROP TABLE memory_l1_search');
  assert.equal(l1.searchIndexStatus(both), 'missing');
  assert.throws(() => recall('独特线索'), code('INDEX_MISSING'));
  const missingReadOnly = OwnedDatabase.open(databasePath, true);
  const missingReader = assembleL1(missingReadOnly);
  assert.equal(missingReader.searchIndexStatus(both), 'missing');
  assert.throws(
    () => missingReader.recall({ query: '独特线索', anchoredSpaceIds: ['personal'] }, both),
    code('INDEX_MISSING')
  );
  missingReadOnly.close();
  raw.exec(
    "CREATE TABLE memory_l1_search (data TEXT); INSERT INTO memory_l1_search VALUES ('do not delete')"
  );
  assert.equal(l1.searchIndexStatus(both), 'unavailable');
  assert.throws(() => recall('独特线索'), code('INDEX_UNAVAILABLE'));
  assert.throws(() => l1.rebuildSearchIndex(both), code('INDEX_UNAVAILABLE'));
  assert.equal(raw.prepare('SELECT data FROM memory_l1_search').get().data, 'do not delete');
  raw.exec('DROP TABLE memory_l1_search');
  l1.rebuildSearchIndex(both);
  assert.equal(l1.searchIndexStatus(both), 'healthy');
  assert.deepEqual(l1.getJobMemories('index-repair', both), before);
  assert.throws(
    () => l1.rebuildSearchIndex({ ...both, canManageSpaces: false }),
    code('ACCESS_DENIED')
  );
  raw.close();
  db.close();
  const readonly = OwnedDatabase.open(databasePath, true);
  const readL1 = assembleL1(readonly);
  assert.equal(readL1.searchIndexStatus(both), 'healthy');
  assert.throws(() => readL1.rebuildSearchIndex(both), code('READ_ONLY'));
  readonly.close();
});

test('index rebuild rolls back if insertion fails', async (t) => {
  const { root, db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原文' },
    personal
  ).message;
  l1.enqueue({ id: 'index-rollback', sourceIds: [source.id] }, personal);
  await l1.run(
    'index-rollback',
    { extract: async () => ({ memories: [draft([source.id])] }) },
    personal
  );
  const before = l1.getJobMemories('index-rollback', personal);
  const { rebuildIndex } = require(path.join(root, 'dist/db/memory/l1-search-index'));
  db.createAdapter((orm) => {
    const originalRun = orm.run.bind(orm);
    let operations = 0;
    orm.run = (statement) => {
      if (++operations === 9) throw new Error('injected rebuild failure');
      return originalRun(statement);
    };
    assert.throws(() => rebuildIndex(orm), /injected rebuild failure/);
  });
  assert.equal(l1.searchIndexStatus(personal), 'healthy');
  assert.deepEqual(l1.getJobMemories('index-rollback', personal), before);
  assert.deepEqual(memory.getL0(source.id, personal), source);
  assert.equal(
    l1.recall({ query: '检索线索', anchoredSpaceIds: ['personal'] }, personal).length,
    1
  );
  db.close();
});

test('corrupt FTS data is detected and can be rebuilt', async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (error) {
    if (error.code === 'ERR_UNKNOWN_BUILTIN_MODULE') return t.skip('node:sqlite is unavailable');
    throw error;
  }
  if (typeof DatabaseSync.prototype.enableDefensive !== 'function')
    return t.skip('requires SQLite defensive configuration');
  const { db, memory, l1, databasePath } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原文' },
    personal
  ).message;
  l1.enqueue({ id: 'index-corrupt', sourceIds: [source.id] }, personal);
  await l1.run(
    'index-corrupt',
    { extract: async () => ({ memories: [draft([source.id], { content: 'abcdefgh' })] }) },
    personal
  );
  const before = l1.getJobMemories('index-corrupt', personal);
  assert.equal(l1.searchIndexStatus(personal), 'healthy');
  assert.equal(
    l1.recall({ query: 'abcdefgh', anchoredSpaceIds: ['personal'] }, personal).length,
    1
  );
  const raw = new DatabaseSync(databasePath);
  raw.enableDefensive(false);
  raw.exec('UPDATE memory_l1_search_data SET block=zeroblob(length(block)) WHERE id>10');
  raw.close();
  assert.equal(l1.searchIndexStatus(personal), 'corrupt');
  assert.throws(
    () => l1.recall({ query: 'abcdefgh', anchoredSpaceIds: ['personal'] }, personal),
    code('INDEX_CORRUPT')
  );
  l1.rebuildSearchIndex(personal);
  assert.equal(l1.searchIndexStatus(personal), 'healthy');
  assert.deepEqual(l1.getJobMemories('index-corrupt', personal), before);
  assert.equal(
    l1.recall({ query: 'abcdefgh', anchoredSpaceIds: ['personal'] }, personal).length,
    1
  );
  db.close();
});

test('L1 jobs survive reopen, are idempotent and require authorized L0 sources', async (t) => {
  const { OwnedDatabase, assembleMemory, assembleL1, databasePath, db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '记住原文' },
    personal
  ).message;
  const job = l1.enqueue({ id: 'job-1', sourceIds: [source.id] }, personal);
  assert.equal(job.state, 'pending');
  assert.deepEqual(l1.enqueue({ id: 'job-1', sourceIds: [source.id] }, personal), job);
  const other = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '另一条' },
    personal
  ).message;
  assert.throws(
    () => l1.enqueue({ id: 'job-1', sourceIds: [other.id] }, personal),
    code('SOURCE_CONFLICT')
  );
  assert.throws(
    () =>
      l1.enqueue({ id: 'denied', sourceIds: [source.id] }, { ...personal, readableSpaceIds: [] }),
    code('INVALID_INPUT')
  );
  db.close();
  const reopened = OwnedDatabase.open(databasePath, false);
  const resumed = assembleL1(reopened);
  assert.equal(resumed.getJob('job-1', personal).state, 'pending');
  assert.deepEqual(
    resumed
      .listJobs({ spaceId: 'personal', state: 'pending', limit: 1 }, personal)
      .jobs.map((x) => x.id),
    ['job-1']
  );
  let calls = 0;
  const result = await resumed.run(
    'job-1',
    {
      extract: async ({ messages }) => {
        calls++;
        return { memories: [draft([messages[0].id])] };
      },
    },
    personal
  );
  assert.equal(calls, 1);
  assert.equal(result.state, 'succeeded');
  const items = resumed.getJobMemories('job-1', personal);
  assert.equal(items.length, 1);
  assert.equal(items[0].maintenanceStatus, 'pending');
  assert.deepEqual(items[0].sourceIds, [source.id]);
  assert.equal(assembleMemory(reopened).getL0(source.id, personal).content, '记住原文');
  await assert.rejects(
    resumed.run('job-1', { extract: async () => ({ memories: [] }) }, personal),
    code('JOB_NOT_PENDING')
  );
  reopened.close();
});

test('each L1 gets source-specific cross-space links and filtered source access', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const project = memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: ['personal', project.id],
    canManageSpaces: true,
  };
  const onlyProject = {
    readableSpaceIds: [project.id],
    writableSpaceIds: [project.id],
    canManageSpaces: false,
  };
  const sourceA = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '私人原文' },
    both
  ).message;
  const sourceB = memory.appendL0(
    { spaceId: project.id, role: 'user', content: '项目原文' },
    both
  ).message;
  assert.throws(
    () => l1.enqueue({ id: 'missing-owner', sourceIds: [sourceA.id, sourceB.id] }, both),
    code('INVALID_INPUT')
  );
  l1.enqueue({ id: 'cross', spaceId: project.id, sourceIds: [sourceA.id, sourceB.id] }, both);
  await l1.run(
    'cross',
    {
      extract: async ({ messages, space, relatedSpaces }) => {
        assert.deepEqual(
          messages.map((m) => m.id),
          [sourceA.id, sourceB.id]
        );
        assert.equal(space.id, project.id);
        assert.deepEqual(
          relatedSpaces.map((s) => s.id),
          ['personal']
        );
        return {
          memories: [
            draft([sourceA.id], { content: 'cross result' }),
            draft([sourceB.id], { content: 'local result' }),
          ],
        };
      },
    },
    both
  );
  const results = l1.getJobMemories('cross', both);
  const cross = results.find((item) => item.content === 'cross result');
  const local = results.find((item) => item.content === 'local result');
  assert.deepEqual(cross.relatedSpaceIds, ['personal']);
  assert.deepEqual(local.relatedSpaceIds, []);
  assert.deepEqual(cross.sourceIds, [sourceA.id]);
  assert.equal(l1.getJob('cross', onlyProject), undefined);
  const limited = l1.getMemory(cross.id, onlyProject);
  assert.deepEqual(limited.sourceIds, []);
  assert.deepEqual(limited.relatedSpaceIds, []);
  assert.equal(limited.sourcesComplete, false);
  db.close();
});

test('model validation failures and unknown outcomes remain observable and require explicit retry', async (t) => {
  const { db, memory, l1, L1ModelError } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: '原始内容' },
    personal
  ).message;
  l1.enqueue({ id: 'invalid', sourceIds: [source.id] }, personal);
  await assert.rejects(
    l1.run('invalid', { extract: async () => ({ memories: [draft(['not-in-batch'])] }) }, personal),
    code('MODEL_FAILED')
  );
  assert.equal(l1.getJob('invalid', personal).state, 'failed');
  assert.equal(l1.getJob('invalid', personal).failureCode, 'MODEL_OUTPUT_INVALID');
  assert.deepEqual(l1.getJobMemories('invalid', personal), []);
  await assert.rejects(
    l1.run('invalid', { extract: async () => ({ memories: [] }) }, personal),
    code('JOB_NOT_PENDING')
  );
  assert.equal(l1.retry('invalid', personal).state, 'pending');
  assert.equal(
    (await l1.run('invalid', { extract: async () => ({ memories: [] }) }, personal)).state,
    'succeeded'
  );
  l1.enqueue({ id: 'unknown', sourceIds: [source.id] }, personal);
  await assert.rejects(
    l1.run(
      'unknown',
      {
        extract: async () => {
          throw new L1ModelError('API_TRANSPORT', 'unknown', 'unknown outcome');
        },
      },
      personal
    ),
    code('MODEL_FAILED')
  );
  assert.equal(l1.getJob('unknown', personal).state, 'unknown');
  assert.equal(memory.getL0(source.id, personal).content, '原始内容');
  assert.equal(l1.retry('unknown', personal).state, 'pending');
  db.close();
});

test('interruption fencing prevents stale execution from committing after an explicit retry', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  l1.enqueue({ id: 'fence', sourceIds: [source.id] }, personal);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const slow = l1
    .run(
      'fence',
      {
        extract: async () => {
          await wait;
          return { memories: [draft([source.id], { content: 'stale' })] };
        },
      },
      personal
    )
    .then(
      () => null,
      (error) => error
    );
  assert.equal(l1.getJob('fence', personal).state, 'running');
  assert.equal(l1.markInterrupted('fence', personal).state, 'unknown');
  assert.equal(l1.retry('fence', personal).state, 'pending');
  await l1.run(
    'fence',
    { extract: async () => ({ memories: [draft([source.id], { content: 'fresh' })] }) },
    personal
  );
  release();
  assert.equal((await slow).code, 'JOB_NOT_PENDING');
  assert.deepEqual(
    l1.getJobMemories('fence', personal).map((m) => m.content),
    ['fresh']
  );
  db.close();
});

test('failed L1 commit rolls back memories, sources and job completion', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  l1.enqueue({ id: 'rollback', sourceIds: [source.id] }, personal);
  const sqlite = db.createAdapter((orm) => orm.$client);
  sqlite.exec(
    "CREATE TRIGGER fail_cue BEFORE INSERT ON memory_l1_cues BEGIN SELECT RAISE(ABORT, 'injected l1 failure'); END"
  );
  await assert.rejects(
    l1.run('rollback', { extract: async () => ({ memories: [draft([source.id])] }) }, personal),
    /injected l1 failure/
  );
  assert.equal(l1.getJob('rollback', personal).state, 'running');
  assert.deepEqual(l1.getJobMemories('rollback', personal), []);
  sqlite.exec('DROP TRIGGER fail_cue');
  assert.equal(l1.markInterrupted('rollback', personal).state, 'unknown');
  l1.retry('rollback', personal);
  assert.equal(
    (
      await l1.run(
        'rollback',
        { extract: async () => ({ memories: [draft([source.id])] }) },
        personal
      )
    ).state,
    'succeeded'
  );
  assert.equal(l1.getJobMemories('rollback', personal).length, 1);
  db.close();
});

for (const api of ['chat', 'responses']) {
  test(`OpenAI ${api} adapter makes one structured API request`, async (t) => {
    const { db, memory, l1, OpenAIExtractionModel } = fixture(t);
    const source = memory.appendL0(
      { spaceId: 'personal', role: 'user', content: '记住 L0' },
      personal
    ).message;
    l1.enqueue({ id: `api-${api}`, sourceIds: [source.id] }, personal);
    let calls = 0;
    const model = new OpenAIExtractionModel({
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
        assert.equal(format.name, 'pmem_l1_memories');
        assert.equal(format.strict, true);
        const user = api === 'chat' ? request.messages[1] : request.input[1];
        assert.equal(JSON.parse(user.content).messages[0].id, source.id);
        const content = JSON.stringify({ memories: [draft([source.id])] });
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
    assert.equal((await l1.run(`api-${api}`, model, personal)).state, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(l1.getJobMemories(`api-${api}`, personal).length, 1);
    db.close();
  });
}

test('revoked access before model commit prevents L1 persistence', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'private' },
    personal
  ).message;
  const access = {
    readableSpaceIds: ['personal'],
    writableSpaceIds: ['personal'],
    canManageSpaces: true,
  };
  l1.enqueue({ id: 'revoked', sourceIds: [source.id] }, access);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = l1.run(
    'revoked',
    {
      extract: async () => {
        await wait;
        return { memories: [draft([source.id])] };
      },
    },
    access
  );
  access.readableSpaceIds.length = 0;
  release();
  await assert.rejects(pending, code('ACCESS_DENIED'));
  assert.equal(l1.getJob('revoked', personal).state, 'failed');
  assert.equal(l1.getJob('revoked', personal).failureCode, 'ACCESS_CHANGED');
  assert.deepEqual(l1.getJobMemories('revoked', personal), []);
  db.close();
});

test('changed L0 after extraction snapshot cannot be committed as if unchanged', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'before' },
    personal
  ).message;
  l1.enqueue({ id: 'changed', sourceIds: [source.id] }, personal);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = l1.run(
    'changed',
    {
      extract: async () => {
        await wait;
        return { memories: [draft([source.id])] };
      },
    },
    personal
  );
  const sqlite = db.createAdapter((orm) => orm.$client);
  sqlite.prepare('UPDATE memory_l0_messages SET content = ? WHERE id = ?').run('after', source.id);
  release();
  await assert.rejects(pending, code('SOURCE_CONFLICT'));
  assert.equal(l1.getJob('changed', personal).state, 'running');
  assert.deepEqual(l1.getJobMemories('changed', personal), []);
  assert.equal(l1.markInterrupted('changed', personal).state, 'unknown');
  db.close();
});

test('two runners cannot execute the same pending job concurrently', async (t) => {
  const { db, memory, l1, OwnedDatabase, assembleL1, databasePath } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  l1.enqueue({ id: 'concurrent', sourceIds: [source.id] }, personal);
  let release;
  let calls = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const model = {
    extract: async () => {
      calls++;
      await wait;
      return { memories: [draft([source.id])] };
    },
  };
  const otherDb = OwnedDatabase.open(databasePath, false);
  const otherRunner = assembleL1(otherDb);
  const first = l1.run('concurrent', model, personal);
  await assert.rejects(otherRunner.run('concurrent', model, personal), code('JOB_NOT_PENDING'));
  release();
  assert.equal((await first).state, 'succeeded');
  assert.equal(calls, 1);
  assert.equal(l1.getJobMemories('concurrent', personal).length, 1);
  otherDb.close();
  db.close();
});

test('OpenAI errors, refusal and incomplete results are not treated as memories', async (t) => {
  const { db, memory, l1, OpenAIExtractionModel } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  const cases = [
    {
      api: 'chat',
      name: 'rate-limit',
      response: new Response('', { status: 429 }),
      expected: 'failed',
      failure: 'API_HTTP',
    },
    {
      api: 'responses',
      name: 'server-error',
      response: new Response('', { status: 503 }),
      expected: 'unknown',
      failure: 'API_HTTP',
    },
    {
      api: 'chat',
      name: 'refusal',
      response: Response.json({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }),
      expected: 'failed',
      failure: 'API_REFUSAL',
    },
    {
      api: 'responses',
      name: 'incomplete',
      response: Response.json({ status: 'incomplete', output: [] }),
      expected: 'failed',
      failure: 'API_INCOMPLETE',
    },
    {
      api: 'chat',
      name: 'bad-json',
      response: Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{' } }] }),
      expected: 'failed',
      failure: 'MODEL_JSON_INVALID',
    },
    {
      api: 'chat',
      name: 'empty-output',
      response: Response.json({ choices: [{ finish_reason: 'stop', message: { content: '  ' } }] }),
      expected: 'failed',
      failure: 'MODEL_OUTPUT_EMPTY',
    },
  ];
  for (const c of cases) {
    l1.enqueue({ id: c.name, sourceIds: [source.id] }, personal);
    const model = new OpenAIExtractionModel({
      api: c.api,
      apiKey: 'test',
      model: 'test',
      fetch: async () => c.response,
    });
    await assert.rejects(l1.run(c.name, model, personal), code('MODEL_FAILED'));
    assert.equal(l1.getJob(c.name, personal).state, c.expected);
    assert.equal(l1.getJob(c.name, personal).failureCode, c.failure);
    assert.deepEqual(l1.getJobMemories(c.name, personal), []);
  }
  db.close();
});

test('L1 migrations preserve existing L0 data and create a pre-upgrade backup', async (t) => {
  const { root, db, OwnedDatabase, assembleMemory, assembleL1 } = fixture(t);
  db.close();
  const journalPath = path.join(root, 'migrations/memory/meta/_journal.json');
  const originalJournal = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(originalJournal);
  journal.entries = journal.entries.slice(0, 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const oldDbPath = path.join(root, 'existing-l0.sqlite');
  const oldDb = OwnedDatabase.create(oldDbPath);
  const source = assembleMemory(oldDb).appendL0(
    { spaceId: 'personal', role: 'user', content: '  原有内容\n```代码```\n' },
    personal
  ).message;
  oldDb.close();
  fs.writeFileSync(journalPath, originalJournal);
  assert.throws(() => OwnedDatabase.open(oldDbPath, false), code('MIGRATION_REQUIRED'));
  const backupPath = path.join(root, 'before-l1.sqlite');
  assert.equal((await OwnedDatabase.migrate(oldDbPath, backupPath)).migrationsApplied, 8);
  const upgraded = OwnedDatabase.open(oldDbPath, false);
  assert.equal(assembleMemory(upgraded).getL0(source.id, personal).content, source.content);
  assert.deepEqual(assembleL1(upgraded).listJobs({ spaceId: 'personal' }, personal).jobs, []);
  upgraded.close();
  const backup = new (require('better-sqlite3'))(backupPath, { readonly: true });
  assert.equal(
    backup.prepare('SELECT content FROM memory_l0_messages WHERE id = ?').get(source.id).content,
    source.content
  );
  assert.equal(
    backup.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'memory_l1'").get().n,
    0
  );
  backup.close();
});

test('invalid or unauthorized related space IDs never become L1 graph edges', async (t) => {
  const { db, memory, l1 } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  const other = memory.createSpace('Other', personal);
  assert.throws(
    () =>
      l1.enqueue(
        { id: 'not-allowed', sourceIds: [source.id], relatedSpaceIds: [other.id] },
        personal
      ),
    code('ACCESS_DENIED')
  );
  l1.enqueue({ id: 'invented', sourceIds: [source.id] }, personal);
  await assert.rejects(
    l1.run(
      'invented',
      {
        extract: async () => ({ memories: [draft([source.id], { relatedSpaceIds: [other.id] })] }),
      },
      personal
    ),
    code('MODEL_FAILED')
  );
  assert.equal(l1.getJob('invented', personal).failureCode, 'MODEL_OUTPUT_INVALID');
  assert.deepEqual(l1.getJobMemories('invented', personal), []);
  db.close();
});

test('transport failure and Responses refusal remain explicit', async (t) => {
  const { db, memory, l1, OpenAIExtractionModel } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  l1.enqueue({ id: 'transport', sourceIds: [source.id] }, personal);
  const transport = new OpenAIExtractionModel({
    api: 'responses',
    apiKey: 'test',
    model: 'test',
    fetch: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(l1.run('transport', transport, personal), code('MODEL_FAILED'));
  assert.equal(l1.getJob('transport', personal).state, 'unknown');
  assert.equal(l1.getJob('transport', personal).failureCode, 'API_TRANSPORT');
  l1.enqueue({ id: 'responses-refusal', sourceIds: [source.id] }, personal);
  const refusal = new OpenAIExtractionModel({
    api: 'responses',
    apiKey: 'test',
    model: 'test',
    fetch: async () =>
      Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
      }),
  });
  await assert.rejects(l1.run('responses-refusal', refusal, personal), code('MODEL_FAILED'));
  assert.equal(l1.getJob('responses-refusal', personal).failureCode, 'API_REFUSAL');
  db.close();
});

test('job pagination does not reveal IDs from inaccessible cross-space tasks', (t) => {
  const { db, memory, l1 } = fixture(t);
  const project = memory.createSpace('Project', personal);
  const both = {
    readableSpaceIds: ['personal', project.id],
    writableSpaceIds: [project.id],
    canManageSpaces: false,
  };
  const projectOnly = {
    readableSpaceIds: [project.id],
    writableSpaceIds: [project.id],
    canManageSpaces: false,
  };
  const privateSource = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'private' },
    personal
  ).message;
  const projectSource = memory.appendL0(
    { spaceId: project.id, role: 'user', content: 'project' },
    both
  ).message;
  l1.enqueue({ id: 'a-visible', sourceIds: [projectSource.id] }, both);
  l1.enqueue({ id: 'm-hidden', spaceId: project.id, sourceIds: [privateSource.id] }, both);
  l1.enqueue({ id: 'z-visible', sourceIds: [projectSource.id] }, both);
  const page1 = l1.listJobs({ spaceId: project.id, limit: 1 }, projectOnly);
  assert.deepEqual(
    page1.jobs.map((job) => job.id),
    ['a-visible']
  );
  assert.equal(page1.nextId, 'a-visible');
  const page2 = l1.listJobs({ spaceId: project.id, limit: 1, afterId: page1.nextId }, projectOnly);
  assert.deepEqual(
    page2.jobs.map((job) => job.id),
    ['z-visible']
  );
  assert.equal(page2.nextId, undefined);
  db.close();
});

test('response body transport interruption is unknown while malformed JSON is failed', async (t) => {
  const { db, memory, l1, OpenAIExtractionModel } = fixture(t);
  const source = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'source' },
    personal
  ).message;
  const cases = [
    {
      id: 'body-interrupted',
      expected: 'unknown',
      fetch: async () => ({
        ok: true,
        json: async () => {
          throw new TypeError('stream interrupted');
        },
      }),
    },
    {
      id: 'body-invalid',
      expected: 'failed',
      fetch: async () => new Response('{', { status: 200 }),
    },
  ];
  for (const c of cases) {
    l1.enqueue({ id: c.id, sourceIds: [source.id] }, personal);
    const model = new OpenAIExtractionModel({
      api: 'responses',
      apiKey: 'test',
      model: 'test',
      fetch: c.fetch,
    });
    await assert.rejects(l1.run(c.id, model, personal), code('MODEL_FAILED'));
    assert.equal(l1.getJob(c.id, personal).state, c.expected);
    assert.equal(l1.getJob(c.id, personal).failureCode, 'API_RESPONSE_INVALID');
  }
  db.close();
});

test('failed L1 upgrade rolls back without losing existing L0 and can be retried', async (t) => {
  const { root, db, OwnedDatabase, assembleMemory } = fixture(t);
  db.close();
  const journalPath = path.join(root, 'migrations/memory/meta/_journal.json');
  const originalJournal = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(originalJournal);
  journal.entries = journal.entries.slice(0, 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const oldDbPath = path.join(root, 'previous-l0.sqlite');
  const oldDb = OwnedDatabase.create(oldDbPath);
  const original = '原始数据\n```ts\nconst x = 1;\n```  ';
  const source = assembleMemory(oldDb).appendL0(
    { spaceId: 'personal', role: 'user', content: original },
    personal
  ).message;
  oldDb.close();
  fs.writeFileSync(journalPath, originalJournal);
  const migrationPath = path.join(root, 'migrations/memory/0002_l1_claim.sql');
  const validSql = fs.readFileSync(migrationPath, 'utf8');
  fs.appendFileSync(migrationPath, '\n--> statement-breakpoint\nTHIS IS INVALID SQL;\n');
  const failedBackup = path.join(root, 'before-failed-upgrade.sqlite');
  await assert.rejects(OwnedDatabase.migrate(oldDbPath, failedBackup));
  const Database = require('better-sqlite3');
  for (const file of [oldDbPath, failedBackup]) {
    const check = new Database(file, { readonly: true });
    assert.equal(
      check.prepare('SELECT content FROM memory_l0_messages WHERE id = ?').get(source.id).content,
      original
    );
    assert.equal(
      check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'memory_l1'").get().n,
      0
    );
    assert.equal(check.prepare('SELECT count(*) AS n FROM pmem_memory_migrations').get().n, 1);
    check.close();
  }
  fs.writeFileSync(migrationPath, validSql);
  assert.equal(
    (await OwnedDatabase.migrate(oldDbPath, path.join(root, 'retry-backup.sqlite')))
      .migrationsApplied,
    8
  );
  const upgraded = OwnedDatabase.open(oldDbPath, false);
  assert.equal(assembleMemory(upgraded).getL0(source.id, personal).content, original);
  upgraded.close();
});

for (const api of ['chat', 'responses']) {
  test(`DeepSeek ${api} uses documented output format and preserves one-call extraction`, async (t) => {
    const { db, memory, l1, OpenAIExtractionModel } = fixture(t);
    const source = memory.appendL0(
      { spaceId: 'personal', role: 'user', content: '我正在编写小说。' },
      personal
    ).message;
    l1.enqueue({ id: `deepseek-${api}`, sourceIds: [source.id] }, personal);
    let calls = 0;
    const model = new OpenAIExtractionModel({
      provider: 'deepseek',
      api,
      apiKey: 'test-key',
      fetch: async (url, options) => {
        calls++;
        assert.equal(
          url,
          `https://api.deepseek.com/${api === 'chat' ? 'chat/completions' : 'responses'}`
        );
        const request = JSON.parse(options.body);
        assert.equal(request.model, 'deepseek-flash');
        assert.equal('store' in request, false);
        if (api === 'chat') {
          assert.deepEqual(request.response_format, { type: 'json_object' });
          assert.equal(request.max_tokens, 8192);
          assert.match(request.messages[0].content, /JSON/);
        } else {
          assert.equal(request.text.format.type, 'json_schema');
          assert.equal(request.text.format.name, 'pmem_l1_memories');
          assert.equal('strict' in request.text.format, false);
          assert.equal(request.max_output_tokens, 8192);
        }
        const content = JSON.stringify({ memories: [draft([source.id])] });
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
    assert.doesNotMatch(JSON.stringify(model), /test-key/);
    assert.equal((await l1.run(`deepseek-${api}`, model, personal)).state, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(l1.getJobMemories(`deepseek-${api}`, personal).length, 1);
    db.close();
  });
}
