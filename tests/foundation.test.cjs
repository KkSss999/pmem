'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-foundation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const dir of ['sdk', 'server', 'db']) {
    fs.cpSync(path.join(__dirname, '..', 'dist', dir), path.join(root, 'dist', dir), {
      recursive: true,
    });
  }
  fs.mkdirSync(path.join(root, 'migrations'));
  fs.copyFileSync(
    path.join(__dirname, '..', 'migrations/0000_foundation.sql'),
    path.join(root, 'migrations/0000_foundation.sql')
  );
  fs.cpSync(path.join(__dirname, '..', 'migrations/meta'), path.join(root, 'migrations/meta'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { Pmem } = require(path.join(root, 'dist/sdk'));
  const { OwnedDatabase } = require(path.join(root, 'dist/db/database'));
  const databasePath = path.join(root, 'pmem.sqlite');
  return { root, Pmem, OwnedDatabase, databasePath };
}

function addMigration(root, owner, name, sql) {
  const folder = path.join(root, 'migrations', owner);
  const journalPath = path.join(folder, 'meta', '_journal.json');
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const journal = fs.existsSync(journalPath)
    ? JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    : { version: '7', dialect: 'sqlite', entries: [] };
  journal.entries.push({
    idx: journal.entries.length,
    version: '6',
    when: journal.entries.length + 1,
    tag: name,
    breakpoints: true,
  });
  fs.writeFileSync(path.join(folder, name + '.sql'), sql);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
}

const initialSql = `CREATE TABLE parents (id integer PRIMARY KEY NOT NULL, name text);
--> statement-breakpoint
CREATE TABLE children (id integer PRIMARY KEY NOT NULL, parent_id integer REFERENCES parents(id) ON DELETE CASCADE);`;
const rebuildSql = `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE __new_parents (id integer PRIMARY KEY NOT NULL, name text NOT NULL);
--> statement-breakpoint
INSERT INTO __new_parents(id,name) SELECT id,name FROM parents;--> statement-breakpoint
DROP TABLE parents;--> statement-breakpoint
ALTER TABLE __new_parents RENAME TO parents;--> statement-breakpoint
PRAGMA foreign_keys=ON;`;

test('domain migrations preserve cascading rows and back up before a table rebuild', async (t) => {
  const { root, Pmem, databasePath } = fixture(t);
  Pmem.create({ databasePath }).close();
  addMigration(root, 'memory', '0000_initial', initialSql);
  addMigration(
    root,
    'knowledge',
    '0000_initial',
    'CREATE TABLE wiki_index (id integer PRIMARY KEY);'
  );
  assert.throws(
    () => Pmem.open({ databasePath }),
    (error) => error.code === 'MIGRATION_REQUIRED'
  );
  const initial = await Pmem.migrate({
    databasePath,
    backupPath: path.join(root, 'initial-backup.sqlite'),
  });
  assert.equal(initial.migrationsApplied, 2);
  let db = new Database(databasePath);
  db.exec("INSERT INTO parents VALUES (1, 'safe'); INSERT INTO children VALUES (1, 1)");
  assert.equal(db.prepare('SELECT count(*) AS n FROM pmem_memory_migrations').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pmem_knowledge_migrations').get().n, 1);
  db.close();
  addMigration(root, 'memory', '0001_rebuild', rebuildSql);
  const backupPath = path.join(root, 'rebuild-backup.sqlite');
  const migrated = await Pmem.migrate({ databasePath, backupPath });
  assert.equal(migrated.migrationsApplied, 1);
  db = new Database(databasePath, { readonly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM children').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pmem_memory_migrations').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pmem_knowledge_migrations').get().n, 1);
  db.close();
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.prepare('SELECT count(*) AS n FROM children').get().n, 1);
  assert.equal(backup.prepare('SELECT count(*) AS n FROM pmem_memory_migrations').get().n, 1);
  backup.close();
  const runtime = Pmem.open({ databasePath });
  assert.equal(runtime.status().schemaVersion, 4);
  runtime.close();
});

test('foreign key violations roll back all pending domain migrations', async (t) => {
  const { root, Pmem, databasePath } = fixture(t);
  Pmem.create({ databasePath }).close();
  addMigration(
    root,
    'memory',
    '0000_invalid',
    `${initialSql}\n--> statement-breakpoint\nINSERT INTO children VALUES (1, 42);`
  );
  addMigration(
    root,
    'knowledge',
    '0000_initial',
    'CREATE TABLE wiki_index (id integer PRIMARY KEY);'
  );
  const backupPath = path.join(root, 'failed-backup.sqlite');
  await assert.rejects(
    Pmem.migrate({ databasePath, backupPath }),
    (error) => error.code === 'FOREIGN_KEY_VIOLATION'
  );
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('parents','children','wiki_index','pmem_memory_migrations','pmem_knowledge_migrations')"
      )
      .get().n,
    0
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM pmem_migrations').get().n, 1);
  db.close();
  assert.equal(fs.existsSync(backupPath), true);
});

test('domain adapter uses the runtime-owned connection and fails after close', (t) => {
  const { OwnedDatabase, databasePath } = fixture(t);
  const database = OwnedDatabase.create(databasePath);
  const adapter = database.createAdapter((orm, readOnly) => ({ orm, readOnly }));
  assert.equal(adapter.readOnly, false);
  assert.equal(adapter.orm.$client.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(adapter.orm.$client.prepare('SELECT 1 AS n').get().n, 1);
  database.close();
  assert.throws(
    () => database.createAdapter(() => null),
    (error) => error.code === 'CLOSED'
  );
  assert.throws(() => adapter.orm.$client.prepare('SELECT 1'), /not open/);
});

test('read-only adapters cannot write and separate runtimes own separate connections', (t) => {
  const { OwnedDatabase, databasePath } = fixture(t);
  const writer = OwnedDatabase.create(databasePath);
  const reader = OwnedDatabase.open(databasePath, true);
  const writable = writer.createAdapter((orm) => orm.$client);
  const readonly = reader.createAdapter((orm, readOnly) => ({ client: orm.$client, readOnly }));
  assert.notEqual(writable, readonly.client);
  assert.equal(readonly.readOnly, true);
  assert.throws(
    () => readonly.client.exec('CREATE TABLE forbidden (id integer)'),
    (error) => error.code === 'SQLITE_READONLY'
  );
  reader.close();
  assert.equal(writable.prepare('SELECT 1 AS n').get().n, 1);
  writer.close();
});

test('missing domain migration files do not silently accept a newer database', async (t) => {
  const { root, Pmem, databasePath } = fixture(t);
  Pmem.create({ databasePath }).close();
  addMigration(root, 'memory', '0000_initial', initialSql);
  await Pmem.migrate({ databasePath, backupPath: path.join(root, 'backup.sqlite') });
  fs.rmSync(path.join(root, 'migrations', 'memory'), { recursive: true });
  assert.throws(
    () => Pmem.open({ databasePath }),
    (error) => error.code === 'UNSUPPORTED_VERSION'
  );
});

test('Drizzle generates independent journals for both domain schemas', async (t) => {
  const { root, Pmem, databasePath } = fixture(t);
  const { execFileSync } = require('node:child_process');
  for (const owner of ['memory', 'knowledge']) {
    const folder = path.join(root, 'src/db', owner);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, 'schema.ts'),
      `import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';\nexport const data = sqliteTable('${owner}_data', { id: integer('id').primaryKey() });\n`
    );
    fs.copyFileSync(
      path.join(__dirname, '..', `drizzle.${owner}.config.ts`),
      path.join(root, `drizzle.${owner}.config.ts`)
    );
    execFileSync(
      path.join(root, 'node_modules/.bin/drizzle-kit'),
      ['generate', '--config', `drizzle.${owner}.config.ts`, '--name', 'initial'],
      { cwd: root, stdio: 'pipe' }
    );
  }
  Pmem.create({ databasePath }).close();
  const db = new Database(databasePath, { readonly: true });
  for (const name of [
    'memory_data',
    'knowledge_data',
    'pmem_memory_migrations',
    'pmem_knowledge_migrations',
  ]) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
    );
  }
  db.close();
});
