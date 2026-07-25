import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const tempDirs: string[] = [];

function run(cwd: string, ...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [PMEM_BIN, ...args], { cwd, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function project(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-forget-cli-'));
  tempDirs.push(cwd);
  const initialized = run(cwd, 'init', 'forget-test');
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return cwd;
}

function eventCount(cwd: string): number {
  const db = new Database(path.join(cwd, '.pmem', 'pmem.db'));
  try {
    return (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pmem forget CLI', () => {
  it('exits 2 and writes no event when the confirmed card ID does not exist', () => {
    const cwd = project();
    const before = eventCount(cwd);
    const result = run(cwd, 'forget', 'module.does_not_exist', '--confirm', '--reason', 'typo');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Memory not found: module\.does_not_exist/);
    assert.doesNotMatch(result.stdout, /Memory forgotten|Tombstone event/);
    assert.equal(eventCount(cwd), before);
  });

  it('preserves successful card tombstoning', () => {
    const cwd = project();
    assert.equal(run(cwd, 'new', 'module', 'Keep', '--id', 'keep').status, 0);
    assert.equal(run(cwd, 'rebuild').status, 0);
    const result = run(cwd, 'forget', 'module.keep', '--confirm', '--reason', 'obsolete');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Memory forgotten: module\.keep/);
    assert.match(result.stdout, /Tombstone event:/);
  });
});
