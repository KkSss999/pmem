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

function tempProject(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-doctor-cli-'));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pmem doctor exit codes', () => {
  it('returns 0 for the same warning-only result in compact and JSON formats', () => {
    const cwd = tempProject();
    const initialized = run(cwd, 'init', 'doctor-test');
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

    const compact = run(cwd, 'doctor');
    const json = run(cwd, 'doctor', '--format', 'json');
    assert.equal(compact.status, 0, compact.stderr || compact.stdout);
    assert.equal(json.status, 0, json.stderr || json.stdout);
    assert.match(compact.stdout, /⚠/);
    const report = JSON.parse(json.stdout);
    assert.equal(report.overall, 'warn');
    assert.ok(report.checks.some((check: { status: string }) => check.status === 'warn'));
  });

  it('returns 2 for the same error result in compact and JSON formats', () => {
    const cwd = tempProject();
    const compact = run(cwd, 'doctor');
    const json = run(cwd, 'doctor', '--format', 'json');
    assert.equal(compact.status, 2);
    assert.equal(json.status, 2);
    assert.match(compact.stdout, /\.pmem\/ directory not found/);
    const report = JSON.parse(json.stdout);
    assert.equal(report.overall, 'error');
    assert.ok(report.checks.some((check: { status: string }) => check.status === 'error'));
  });

  it('distinguishes a stale or invalid empty index from a genuinely empty project', () => {
    const cwd = tempProject();
    const initialized = run(cwd, 'init', 'doctor-stale-index');
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

    const cardDir = path.join(cwd, '.pmem', 'decisions');
    fs.mkdirSync(cardDir, { recursive: true });
    fs.writeFileSync(path.join(cardDir, 'decision.stale.md'), `---
id: decision.stale
type: decision
---
# Stale source card
`, 'utf8');

    const db = new Database(path.join(cwd, '.pmem', 'pmem.db'));
    try {
      db.exec('DELETE FROM cards');
    } finally {
      db.close();
    }

    const json = run(cwd, 'doctor', '--format', 'json');
    assert.equal(json.status, 0, json.stderr || json.stdout);
    const report = JSON.parse(json.stdout);
    const check = report.checks.find((item: { name: string }) => item.name === 'card_index');
    assert.ok(check, JSON.stringify(report));
    assert.equal(check.status, 'warn');
    assert.match(check.message, /source card file\(s\).*0 active cards are indexed/);
    assert.match(check.fix, /pmem rebuild/);
  });

  it('warns when source cards exist but the database contains only tombstones', () => {
    const cwd = tempProject();
    const initialized = run(cwd, 'init', 'doctor-tombstone-index');
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

    const cardDir = path.join(cwd, '.pmem', 'modules');
    fs.mkdirSync(cardDir, { recursive: true });
    fs.writeFileSync(path.join(cardDir, 'module.tombstoned.md'), `---
id: module.tombstoned
type: module
---
# Tombstoned source card
`, 'utf8');
    const rebuilt = run(cwd, 'rebuild');
    assert.equal(rebuilt.status, 0, rebuilt.stderr || rebuilt.stdout);

    const db = new Database(path.join(cwd, '.pmem', 'pmem.db'));
    try {
      db.exec('UPDATE cards SET is_deleted = 1');
    } finally {
      db.close();
    }

    const json = run(cwd, 'doctor', '--format', 'json');
    assert.equal(json.status, 0, json.stderr || json.stdout);
    const report = JSON.parse(json.stdout);
    const check = report.checks.find((item: { name: string }) => item.name === 'card_index');
    assert.ok(check, JSON.stringify(report));
    assert.equal(check.status, 'warn');
    assert.match(check.message, /0 active cards are indexed/);
    assert.match(check.message, /tombstone row/);
    assert.match(check.fix, /pmem rebuild/);
    assert.ok(!report.checks.some((item: { name: string; status: string; message: string }) =>
      item.name === 'cards' && item.status === 'ok' && /0 active card/.test(item.message)));
  });
});
