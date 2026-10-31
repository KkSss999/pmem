'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');

function fixture(t, withMemory = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-l0-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const dir of ['sdk', 'server', 'db', 'domain', 'service']) {
    fs.cpSync(path.join(__dirname, '..', 'dist', dir), path.join(root, 'dist', dir), {
      recursive: true,
    });
  }
  fs.cpSync(path.join(__dirname, '..', 'migrations'), path.join(root, 'migrations'), {
    recursive: true,
  });
  if (!withMemory) fs.rmSync(path.join(root, 'migrations/memory'), { recursive: true });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { OwnedDatabase } = require(path.join(root, 'dist/db/database'));
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  return { root, OwnedDatabase, assembleMemory, databasePath: path.join(root, 'memory.sqlite') };
}

const personal = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: true,
};
const code = (expected) => (error) => error && error.code === expected;

test('new database creates personal space and preserves L0 text exactly across reopen', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  let db = OwnedDatabase.create(databasePath);
  let memory = assembleMemory(db);
  assert.deepEqual(
    memory.listSpaces(personal).map((s) => [s.id, s.kind]),
    [['personal', 'personal']]
  );
  assert.deepEqual(memory.anchorSpaces([], personal), ['personal']);
  const content = '  原文\r\n\n```ts\nconst a = "你好 🐈";\n```\n\u0000  ';
  const input = {
    spaceId: 'personal',
    role: 'assistant',
    content,
    sessionId: 'session-1',
    occurredAt: '2026-10-30T10:05:33+08:00',
  };
  const created = memory.appendL0(input, personal);
  assert.equal(created.created, true);
  assert.equal(created.message.content, content);
  db.close();
  db = OwnedDatabase.open(databasePath, false);
  memory = assembleMemory(db);
  const restored = memory.getL0(created.message.id, personal);
  assert.equal(restored.content, content);
  assert.equal(restored.occurredAt, input.occurredAt);
  assert.ok(restored.recordedAt);
  assert.equal(
    memory.listL0({ spaceId: 'personal', sessionId: 'session-1' }, personal).messages[0].content,
    content
  );
  db.close();
});

test('space access and anchoring are enforced for reads and writes', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  const space = memory.createSpace('Project', personal);
  const projectAccess = {
    readableSpaceIds: ['personal', space.id],
    writableSpaceIds: [space.id],
    canManageSpaces: false,
  };
  const projectOnly = {
    readableSpaceIds: [space.id],
    writableSpaceIds: [space.id],
    canManageSpaces: false,
  };
  const secret = memory.appendL0(
    { spaceId: space.id, role: 'user', content: 'project memory' },
    projectAccess
  ).message;
  const privateMessage = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'personal memory' },
    personal
  ).message;
  assert.deepEqual(memory.anchorSpaces([space.id, space.id], projectAccess), [
    'personal',
    space.id,
  ]);
  assert.throws(() => memory.anchorSpaces([space.id], personal), code('ACCESS_DENIED'));
  assert.throws(() => memory.anchorSpaces([space.id], projectOnly), code('ACCESS_DENIED'));
  assert.equal(memory.getL0(secret.id, personal), undefined);
  assert.equal(memory.getL0(privateMessage.id, projectOnly), undefined);
  assert.throws(() => memory.listL0({ spaceId: space.id }, personal), code('ACCESS_DENIED'));
  assert.throws(
    () => memory.appendL0({ spaceId: space.id, role: 'user', content: 'x' }, personal),
    code('ACCESS_DENIED')
  );
  const writeOnly = { readableSpaceIds: [], writableSpaceIds: [space.id], canManageSpaces: false };
  assert.throws(
    () => memory.appendL0({ spaceId: space.id, role: 'user', content: 'x' }, writeOnly),
    code('ACCESS_DENIED')
  );
  assert.deepEqual(
    memory.listSpaces(personal).map((s) => s.id),
    ['personal']
  );
  assert.throws(() => memory.createSpace('denied', projectAccess), code('ACCESS_DENIED'));
  db.close();
});

test('source event replay is idempotent, conflicts do not overwrite and namespaces remain separate', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  const event = {
    spaceId: 'personal',
    role: 'user',
    content: 'same text',
    source: 'agent/session-1',
    sourceEventId: 'event-1',
    sessionId: 's1',
  };
  const first = memory.appendL0(event, personal);
  const again = memory.appendL0(event, personal);
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.deepEqual(again.message, first.message);
  assert.throws(
    () => memory.appendL0({ ...event, content: 'different' }, personal),
    code('SOURCE_CONFLICT')
  );
  assert.throws(
    () => memory.appendL0({ ...event, sessionId: 'different' }, personal),
    code('SOURCE_CONFLICT')
  );
  assert.throws(
    () =>
      memory.appendL0(
        { spaceId: 'personal', role: 'user', content: 'x', sourceEventId: 'id' },
        personal
      ),
    code('INVALID_INPUT')
  );
  const other = memory.appendL0({ ...event, source: 'agent/session-2' }, personal);
  const anonymous1 = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'same text' },
    personal
  );
  const anonymous2 = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'same text' },
    personal
  );
  assert.notEqual(other.message.id, first.message.id);
  assert.notEqual(anonymous1.message.id, anonymous2.message.id);
  assert.equal(memory.getL0(first.message.id, personal).content, 'same text');
  assert.equal(memory.listL0({ spaceId: 'personal' }, personal).messages.length, 4);
  db.close();
});

test('forward pagination, timestamps and rejected inputs preserve existing data', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  for (const content of ['a', 'b', 'c'])
    memory.appendL0({ spaceId: 'personal', role: 'user', content }, personal);
  const p1 = memory.listL0({ spaceId: 'personal', limit: 2 }, personal);
  const p2 = memory.listL0(
    { spaceId: 'personal', limit: 2, afterSequence: p1.nextSequence },
    personal
  );
  assert.deepEqual(
    p1.messages.map((x) => x.content),
    ['a', 'b']
  );
  assert.deepEqual(
    p2.messages.map((x) => x.content),
    ['c']
  );
  assert.equal(p2.nextSequence, undefined);
  assert.equal(p1.messages[0].occurredAt, undefined);
  assert.throws(
    () => memory.appendL0({ spaceId: 'personal', role: 'tool', content: 'x' }, personal),
    code('INVALID_INPUT')
  );
  assert.throws(
    () =>
      memory.appendL0(
        { spaceId: 'personal', role: 'user', content: 'x', occurredAt: '2026-02-29T12:00:00Z' },
        personal
      ),
    code('INVALID_INPUT')
  );
  assert.throws(
    () => memory.listL0({ spaceId: 'personal', limit: 0 }, personal),
    code('INVALID_INPUT')
  );
  assert.equal(memory.listL0({ spaceId: 'personal' }, personal).messages.length, 3);
  db.close();
});

test('read-only opens and rejected writes do not modify the database', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const writer = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(writer);
  const message = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'keep' },
    personal
  ).message;
  writer.close();
  const before = fs.readFileSync(databasePath);
  const reader = OwnedDatabase.open(databasePath, true);
  const readMemory = assembleMemory(reader);
  assert.equal(readMemory.getL0(message.id, personal).content, 'keep');
  assert.throws(
    () => readMemory.appendL0({ spaceId: 'personal', role: 'user', content: 'no' }, personal),
    code('READ_ONLY')
  );
  assert.throws(() => readMemory.createSpace('no', personal), code('READ_ONLY'));
  reader.close();
  assert.deepEqual(fs.readFileSync(databasePath), before);
});

test('foundation migration requires explicit backup and rolls back on failure', async (t) => {
  const { root, OwnedDatabase, assembleMemory, databasePath } = fixture(t, false);
  const initial = OwnedDatabase.create(databasePath);
  initial.close();
  fs.cpSync(path.join(__dirname, '..', 'migrations/memory'), path.join(root, 'migrations/memory'), {
    recursive: true,
  });
  assert.throws(() => OwnedDatabase.open(databasePath, false), code('MIGRATION_REQUIRED'));
  const blockedBackup = path.join(root, 'existing-backup.sqlite');
  fs.writeFileSync(blockedBackup, 'existing');
  await assert.rejects(OwnedDatabase.migrate(databasePath, blockedBackup), code('EEXIST'));
  assert.equal(fs.readFileSync(blockedBackup, 'utf8'), 'existing');
  const migration = path.join(root, 'migrations/memory/0000_initial.sql');
  const originalSql = fs.readFileSync(migration, 'utf8');
  fs.appendFileSync(migration, '\n--> statement-breakpoint\nTHIS IS INVALID SQL;\n');
  const failedBackup = path.join(root, 'failed-backup.sqlite');
  await assert.rejects(OwnedDatabase.migrate(databasePath, failedBackup));
  const check = new Database(databasePath, { readonly: true });
  assert.equal(
    check
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('memory_spaces', 'memory_l0_messages', 'pmem_memory_migrations')"
      )
      .get().n,
    0
  );
  check.close();
  assert.ok(fs.existsSync(failedBackup));
  fs.writeFileSync(migration, originalSql);
  const backupPath = path.join(root, 'backup.sqlite');
  assert.equal((await OwnedDatabase.migrate(databasePath, backupPath)).migrationsApplied, 6);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(
    backup.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'memory_spaces'").get().n,
    0
  );
  backup.close();
  const migrated = OwnedDatabase.open(databasePath, false);
  assert.deepEqual(
    assembleMemory(migrated)
      .listSpaces(personal)
      .map((s) => s.id),
    ['personal']
  );
  migrated.close();
});

test('failed insert rolls back and the same source event can be retried', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  const sqlite = db.createAdapter((orm) => orm.$client);
  sqlite.exec(
    "CREATE TRIGGER inject_failure AFTER INSERT ON memory_l0_messages BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
  );
  const event = {
    spaceId: 'personal',
    role: 'user',
    content: 'keep me',
    source: 'source',
    sourceEventId: 'event-1',
  };
  assert.throws(() => memory.appendL0(event, personal), /injected failure/);
  assert.equal(memory.listL0({ spaceId: 'personal' }, personal).messages.length, 0);
  sqlite.exec('DROP TRIGGER inject_failure');
  const stored = memory.appendL0(event, personal);
  assert.equal(stored.created, true);
  assert.equal(memory.appendL0(event, personal).created, false);
  assert.equal(memory.getL0(stored.message.id, personal).content, 'keep me');
  db.close();
});

test('lock contention is reported and retry after unlock stores one event', (t) => {
  const { OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  db.createAdapter((orm) => orm.$client.pragma('busy_timeout = 25'));
  const blocker = new Database(databasePath);
  blocker.exec('BEGIN EXCLUSIVE');
  const event = {
    spaceId: 'personal',
    role: 'user',
    content: 'lock-safe',
    source: 'source',
    sourceEventId: 'event-lock',
  };
  try {
    assert.throws(() => memory.appendL0(event, personal), code('SQLITE_BUSY'));
  } finally {
    blocker.exec('ROLLBACK');
    blocker.close();
  }
  assert.equal(memory.appendL0(event, personal).created, true);
  assert.equal(memory.appendL0(event, personal).created, false);
  assert.equal(memory.listL0({ spaceId: 'personal' }, personal).messages.length, 1);
  db.close();
});

test('concurrent retries from separate connections produce one stored source event', async (t) => {
  const { root, OwnedDatabase, assembleMemory, databasePath } = fixture(t);
  OwnedDatabase.create(databasePath).close();
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { OwnedDatabase } = require(workerData.root + '/dist/db/database');
    const { assembleMemory } = require(workerData.root + '/dist/server/memory');
    const db = OwnedDatabase.open(workerData.path, false);
    const memory = assembleMemory(db);
    parentPort.postMessage({ ready: true });
    parentPort.once('message', () => {
      try {
        const result = memory.appendL0({spaceId:'personal', role:'user', content:'same', source:'agent', sourceEventId:'shared'},
          {readableSpaceIds:['personal'], writableSpaceIds:['personal'], canManageSpaces:false});
        db.close();
        parentPort.postMessage({created: result.created, id: result.message.id});
      } catch (error) {
        db.close();
        parentPort.postMessage({error: String(error)});
      }
    });
  `;
  const workers = [1, 2].map(
    () => new Worker(workerSource, { eval: true, workerData: { root, path: databasePath } })
  );
  const nextMessage = (worker) =>
    new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  await Promise.all(workers.map(nextMessage));
  const replies = workers.map(nextMessage);
  workers.forEach((worker) => worker.postMessage('go'));
  const result = await Promise.all(replies);
  assert.deepEqual(result.map((r) => r.created).sort(), [false, true]);
  assert.equal(result[0].id, result[1].id);
  await Promise.all(workers.map((worker) => worker.terminate()));
  const db = OwnedDatabase.open(databasePath, false);
  assert.equal(assembleMemory(db).listL0({ spaceId: 'personal' }, personal).messages.length, 1);
  db.close();
});

test('workspace defaults to the home directory and creates only an explicitly selected test workspace', (t) => {
  const { root, assembleMemory } = fixture(t);
  const { defaultWorkspaceRoot, createWorkspace, openWorkspace } = require(
    path.join(root, 'dist/server/workspace')
  );
  assert.equal(defaultWorkspaceRoot(), path.join(os.homedir(), '.pmem'));
  const workspace = path.join(root, 'local-workspace');
  assert.throws(() => openWorkspace(workspace, true), code('ENOENT'));
  assert.equal(fs.existsSync(workspace), false);
  const created = createWorkspace(workspace);
  const memory = assembleMemory(created);
  const stored = memory.appendL0(
    { spaceId: 'personal', role: 'user', content: 'workspace data' },
    personal
  ).message;
  created.close();
  assert.ok(fs.existsSync(path.join(workspace, 'pmem.sqlite')));
  assert.throws(() => createWorkspace(workspace), code('EEXIST'));
  const reopened = openWorkspace(workspace, true);
  assert.equal(assembleMemory(reopened).getL0(stored.id, personal).content, 'workspace data');
  reopened.close();
});
