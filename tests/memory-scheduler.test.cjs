'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-scheduler-'));
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
  const { assembleL1Scheduler } = require(path.join(root, 'dist/server/l1-scheduler'));
  const { L1ModelError } = require(path.join(root, 'dist/domain/memory/l1'));
  const databasePath = path.join(root, 'memory.sqlite');
  const db = OwnedDatabase.create(databasePath);
  return {
    root,
    db,
    databasePath,
    OwnedDatabase,
    assembleMemory,
    assembleL1,
    assembleL1Scheduler,
    L1ModelError,
  };
}

const access = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const message = (session, content, source = 'agent') => ({
  spaceId: 'personal',
  role: 'user',
  source,
  sessionId: session,
  content,
});
const waitFor = async (condition) => {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Timed out waiting for scheduler.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('threshold batches 10 in sequence and idle tail survives restart', async (t) => {
  const f = fixture(t);
  const calls = [];
  const model = {
    extract: async ({ messages }) => {
      calls.push(messages.map((m) => m.content));
      return { memories: [] };
    },
  };
  const first = f.assembleL1Scheduler(f.db, model, access);
  first.start();
  assert.throws(
    () => first.capture({ spaceId: 'personal', role: 'user', content: 'x' }),
    (e) => e.code === 'INVALID_INPUT'
  );
  for (let i = 0; i < 12; i++) first.capture(message('session', String(i)));
  await waitFor(() => calls.length === 1 && first.status().activeJobIds.length === 0);
  assert.deepEqual(
    calls[0],
    Array.from({ length: 10 }, (_, i) => String(i))
  );
  await first.stop();
  f.db.close();
  const db = f.OwnedDatabase.open(f.databasePath, false);
  const sql = new Database(f.databasePath);
  sql.prepare('UPDATE memory_l1_auto_groups SET last_activity = ?').run('2000-01-01T00:00:00.000Z');
  sql.close();
  const resumed = f.assembleL1Scheduler(db, model, access);
  resumed.start();
  await waitFor(() => calls.length === 2 && resumed.status().activeJobIds.length === 0);
  assert.deepEqual(calls[1], ['10', '11']);
  await resumed.stop();
  await resumed.stop();
  db.close();
});

test('sessions and sources remain separate, and two workers do not duplicate a batch', async (t) => {
  const f = fixture(t);
  const otherDb = f.OwnedDatabase.open(f.databasePath, false);
  const started = [];
  const releases = [];
  const model = {
    extract: ({ messages }) =>
      new Promise((resolve) => {
        started.push(messages.map((m) => m.content));
        releases.push(() => resolve({ memories: [] }));
      }),
  };
  const one = f.assembleL1Scheduler(f.db, model, access);
  const two = f.assembleL1Scheduler(otherDb, model, access);
  one.start();
  two.start();
  for (let i = 0; i < 10; i++) one.capture(message('a', `a${i}`));
  for (let i = 0; i < 10; i++) one.capture(message('b', `b${i}`));
  for (let i = 0; i < 10; i++) one.capture(message('a', `c${i}`, 'other-agent'));
  await waitFor(() => started.length === 3);
  one.tick();
  two.tick();
  assert.equal(started.length, 3);
  assert.deepEqual(started.map((batch) => batch[0]).sort(), ['a0', 'b0', 'c0']);
  for (const release of releases) release();
  await waitFor(() => one.status().activeJobIds.length + two.status().activeJobIds.length === 0);
  const l1 = f.assembleL1(f.db);
  assert.equal(l1.listJobs({ spaceId: 'personal', state: 'succeeded' }, access).jobs.length, 3);
  await one.stop();
  await two.stop();
  otherDb.close();
  f.db.close();
});

for (const outcome of ['failed', 'unknown']) {
  test(`${outcome} batches block their own group but not other groups, with explicit retry`, async (t) => {
    const f = fixture(t);
    const calls = [];
    let fail = true;
    const model = {
      extract: async ({ messages }) => {
        const label = messages[0].content;
        calls.push(label);
        if (label.startsWith('bad') && fail)
          throw new f.L1ModelError('TEMP', outcome, 'model error');
        return { memories: [] };
      },
    };
    const scheduler = f.assembleL1Scheduler(f.db, model, access);
    scheduler.start();
    for (let i = 0; i < 20; i++) scheduler.capture(message('bad', `bad${i}`));
    for (let i = 0; i < 10; i++) scheduler.capture(message('good', `good${i}`));
    const l1 = f.assembleL1(f.db);
    await waitFor(
      () =>
        l1.listJobs({ spaceId: 'personal', state: outcome }, access).jobs.length === 1 &&
        calls.includes('good0')
    );
    scheduler.tick();
    assert.deepEqual(
      calls.filter((c) => c.startsWith('bad')),
      ['bad0']
    );
    const failed = l1.listJobs({ spaceId: 'personal', state: outcome }, access).jobs[0];
    fail = false;
    l1.retry(failed.id, access);
    scheduler.tick();
    await waitFor(() => calls.includes('bad10') && scheduler.status().activeJobIds.length === 0);
    assert.deepEqual(
      calls.filter((c) => c.startsWith('bad')),
      ['bad0', 'bad0', 'bad10']
    );
    await scheduler.stop();
    f.db.close();
  });
}

test('a persisted running job is not replayed on restart until explicitly resolved', async (t) => {
  const f = fixture(t);
  const memory = f.assembleMemory(f.db);
  const l1 = f.assembleL1(f.db);
  const source = memory.appendL0(message('crashed', 'original'), access).message;
  l1.enqueue({ id: 'interrupted', sourceIds: [source.id] }, access);
  const raw = new Database(f.databasePath);
  raw
    .prepare("UPDATE memory_l1_jobs SET state = 'running', claim_token = 'abandoned' WHERE id = ?")
    .run('interrupted');
  raw
    .prepare('UPDATE memory_l1_auto_groups SET cursor = ?, active_job_id = ?')
    .run(source.sequence, 'interrupted');
  raw.close();
  const calls = [];
  const scheduler = f.assembleL1Scheduler(
    f.db,
    {
      extract: async () => {
        calls.push('run');
        return { memories: [] };
      },
    },
    access
  );
  scheduler.start();
  scheduler.tick();
  assert.deepEqual(calls, []);
  assert.equal(l1.getJob('interrupted', access).state, 'running');
  assert.equal(l1.markInterrupted('interrupted', access).state, 'unknown');
  scheduler.tick();
  assert.deepEqual(calls, []);
  l1.retry('interrupted', access);
  scheduler.tick();
  await waitFor(() => l1.getJob('interrupted', access).state === 'succeeded');
  assert.deepEqual(calls, ['run']);
  await scheduler.stop();
  f.db.close();
});

test('scheduler migration backfills eligible L0 without repeating a previously assigned job', async (t) => {
  const f = fixture(t);
  f.db.close();
  const journalPath = path.join(f.root, 'migrations/memory/meta/_journal.json');
  const journalText = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(journalText);
  journal.entries = journal.entries.slice(0, 4);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const oldPath = path.join(f.root, 'old.sqlite');
  const old = f.OwnedDatabase.create(oldPath);
  const memory = f.assembleMemory(old);
  const manual = memory.appendL0(message('old', 'already assigned'), access).message;
  memory.appendL0(message('old', 'remaining'), access);
  f.assembleL1(old).enqueue({ id: 'manual', sourceIds: [manual.id] }, access);
  old.close();
  fs.writeFileSync(journalPath, journalText);
  const migrationPath = path.join(f.root, 'migrations/memory/0004_l1_scheduler.sql');
  const valid = fs.readFileSync(migrationPath, 'utf8');
  fs.appendFileSync(migrationPath, '\n--> statement-breakpoint\nINVALID SQL;\n');
  await assert.rejects(
    f.OwnedDatabase.migrate(oldPath, path.join(f.root, 'failure-backup.sqlite'))
  );
  const before = new Database(oldPath, { readonly: true });
  assert.equal(before.prepare('SELECT count(*) n FROM memory_l0_messages').get().n, 2);
  assert.equal(
    before
      .prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'memory_l1_auto_groups'")
      .get().n,
    0
  );
  before.close();
  fs.writeFileSync(migrationPath, valid);
  const backupPath = path.join(f.root, 'backup.sqlite');
  assert.equal((await f.OwnedDatabase.migrate(oldPath, backupPath)).migrationsApplied, 3);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.prepare('SELECT count(*) n FROM memory_l0_messages').get().n, 2);
  backup.close();
  const raw = new Database(oldPath);
  raw.prepare('UPDATE memory_l1_auto_groups SET last_activity = ?').run('2000-01-01T00:00:00.000Z');
  raw.close();
  const db = f.OwnedDatabase.open(oldPath, false);
  const calls = [];
  const scheduler = f.assembleL1Scheduler(
    db,
    {
      extract: async ({ messages }) => {
        calls.push(messages.map((m) => m.content));
        return { memories: [] };
      },
    },
    access
  );
  scheduler.start();
  await waitFor(() => calls.length === 1 && scheduler.status().activeJobIds.length === 0);
  assert.deepEqual(calls, [['remaining']]);
  await scheduler.stop();
  db.close();
});

test('stop waits for active extraction and leaves later work for a future scheduler', async (t) => {
  const f = fixture(t);
  let release;
  const calls = [];
  const scheduler = f.assembleL1Scheduler(
    f.db,
    {
      extract: ({ messages }) => {
        calls.push(messages[0].content);
        return new Promise((resolve) => {
          release = () => resolve({ memories: [] });
        });
      },
    },
    access
  );
  scheduler.start();
  for (let i = 0; i < 10; i++) scheduler.capture(message('stop', `first${i}`));
  await waitFor(() => calls.length === 1);
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  const memory = f.assembleMemory(f.db);
  for (let i = 0; i < 10; i++) memory.appendL0(message('stop', `second${i}`), access);
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.deepEqual(calls, ['first0']);
  const resumed = f.assembleL1Scheduler(
    f.db,
    {
      extract: async ({ messages }) => {
        calls.push(messages[0].content);
        return { memories: [] };
      },
    },
    access
  );
  resumed.start();
  await waitFor(() => calls.length === 2 && resumed.status().activeJobIds.length === 0);
  assert.deepEqual(calls, ['first0', 'second0']);
  await resumed.stop();
  f.db.close();
});

test('scheduling transaction rolls back, reports failure, and resumes after repair', async (t) => {
  const f = fixture(t);
  const connection = new Database(f.databasePath);
  connection.exec(
    "CREATE TRIGGER test_fail_schedule BEFORE INSERT ON memory_l1_job_sources BEGIN SELECT RAISE(ABORT, 'blocked'); END"
  );
  const model = { extract: async () => ({ memories: [] }) };
  const scheduler = f.assembleL1Scheduler(f.db, model, access);
  scheduler.start();
  for (let i = 0; i < 10; i++) scheduler.capture(message('failure', `message${i}`));
  await waitFor(() => scheduler.status().suspended);
  assert.ok(scheduler.status().lastError);
  assert.equal(connection.prepare('SELECT count(*) n FROM memory_l1_jobs').get().n, 0);
  assert.deepEqual(
    connection.prepare('SELECT cursor, active_job_id FROM memory_l1_auto_groups').get(),
    { cursor: 0, active_job_id: null }
  );
  assert.equal(connection.prepare('SELECT count(*) n FROM memory_l0_messages').get().n, 10);
  connection.exec('DROP TRIGGER test_fail_schedule');
  scheduler.resume();
  const l1 = f.assembleL1(f.db);
  await waitFor(
    () => l1.listJobs({ spaceId: 'personal', state: 'succeeded' }, access).jobs.length === 1
  );
  await scheduler.stop();
  connection.close();
  f.db.close();
});

test('scheduler requires read and write access and rejects read-only databases', async (t) => {
  const f = fixture(t);
  const model = { extract: async () => ({ memories: [] }) };
  const writeOnly = {
    readableSpaceIds: [],
    writableSpaceIds: ['personal'],
    canManageSpaces: false,
  };
  const scheduler = f.assembleL1Scheduler(f.db, model, writeOnly);
  scheduler.start();
  assert.throws(
    () => scheduler.capture(message('s', 'x')),
    (error) => error.code === 'ACCESS_DENIED'
  );
  await scheduler.stop();
  f.db.close();
  const readOnly = f.OwnedDatabase.open(f.databasePath, true);
  assert.throws(
    () => f.assembleL1Scheduler(readOnly, model, access),
    (error) => error.code === 'READ_ONLY'
  );
  readOnly.close();
});
