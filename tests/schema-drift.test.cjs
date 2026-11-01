'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// Tables that migrations create without a Drizzle declaration: FTS5 indexes (with their
// shadow tables) and the per-owner migration ledgers.
const RAW_TABLE =
  /^(memory_l1_search|memory_l2_search|memory_l3_fts)(_.+)?$|^pmem_(memory_)?migrations$/;

// Removed from the schema and dropped by 0012/0013; they must never come back by accident.
const RETIRED_TABLES = [
  'memory_l1_jobs',
  'memory_l1_job_results',
  'memory_l1_job_sources',
  'memory_l1_job_spaces',
  'memory_l1_auto_groups',
  'memory_l2_jobs',
  'memory_l2_job_results',
  'memory_l2_changes',
  'memory_l3_jobs',
  'memory_l3_job_results',
  'memory_l3_changes',
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-schema-'));
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
  const databasePath = path.join(root, 'schema.sqlite');
  OwnedDatabase.create(databasePath).close();
  const Database = require(path.join(root, 'node_modules/better-sqlite3'));
  const raw = new Database(databasePath, { readonly: true });
  t.after(() => raw.close());
  return { root, raw };
}

function declaredTables(root) {
  const { getTableName, getTableColumns } = require(path.join(root, 'node_modules/drizzle-orm'));
  const tables = new Map();
  for (const modulePath of ['dist/db/memory/schema', 'dist/db/memory/stream-schema']) {
    const module = require(path.join(root, modulePath));
    for (const value of Object.values(module)) {
      let name;
      try {
        name = getTableName(value);
      } catch {
        continue;
      }
      if (typeof name !== 'string') continue;
      tables.set(
        name,
        Object.values(getTableColumns(value))
          .map((column) => column.name)
          .sort()
      );
    }
  }
  return tables;
}

test('declared tables match the migrated database exactly', (t) => {
  const { root, raw } = fixture(t);
  const declared = declaredTables(root);
  assert.ok(declared.size > 0, 'the schema must declare tables');

  const actual = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));

  for (const [name, columns] of declared) {
    const exists = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    assert.ok(exists, `declared table ${name} is missing from the migrated database`);
    const migrated = raw
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all(name)
      .map((row) => row.name)
      .sort();
    assert.deepEqual(migrated, columns, `declared columns of ${name} drifted from migrations`);
  }

  const undeclared = actual.filter((name) => !declared.has(name) && !RAW_TABLE.test(name));
  assert.deepEqual(undeclared, [], 'migrated tables must be declared or explicitly raw');
});

test('the retired job pipeline tables never reappear', (t) => {
  const { raw } = fixture(t);
  const actual = new Set(
    raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  for (const table of RETIRED_TABLES) assert.ok(!actual.has(table), `${table} must stay dropped`);
});
