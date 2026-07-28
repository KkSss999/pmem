import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lockOwnedBySelf, withLock } from '../core/fs';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { closeDatabase, createSchema, openOwnedDatabase } from '../core/db';
import { writeHealthBaseline } from '../core/health';
import { verifyCommand } from './verify';

const tempDirs: string[] = [];

afterEach(() => {
  closeDatabase();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('health baseline locking', () => {
  it('keeps an outer lock held while nested verification runs', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-lock-'));
    tempDirs.push(cwd);
    const pmemPath = path.join(cwd, '.pmem');
    const lockPath = path.join(pmemPath, '.lock');
    fs.mkdirSync(pmemPath);
    saveManifest(pmemPath, getDefaultManifest('health-lock-test'));

    withLock(pmemPath, () => {
      assert.equal(lockOwnedBySelf(lockPath), true);
      assert.ok(verifyCommand({ cwd, noExit: true, silent: true }));
      assert.equal(lockOwnedBySelf(lockPath), true);
    });

    assert.equal(fs.existsSync(lockPath), false);
  });

  it('explicitly rejects JSON output combined with mutating repairs', () => {
    assert.throws(() => verifyCommand({ format: 'json', fix: true }), /cannot be combined/);
    assert.throws(() => verifyCommand({ format: 'json', fixStale: true }), /cannot be combined/);
  });

  it('detects production orphan-edge evidence growth against a baseline', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-evidence-'));
    tempDirs.push(cwd);
    const pmemPath = path.join(cwd, '.pmem');
    fs.mkdirSync(pmemPath);
    saveManifest(pmemPath, getDefaultManifest('health-evidence-test'));

    const insertOrphan = (from: string, to: string): void => {
      const db = openOwnedDatabase(pmemPath);
      try {
        createSchema(db);
        db.prepare('INSERT INTO edges (from_id, to_id, type, source) VALUES (?, ?, ?, ?)')
          .run(from, to, 'depends_on', 'explicit');
      } finally {
        closeDatabase(db);
      }
    };

    insertOrphan('missing.one', 'missing.target');
    const initial = verifyCommand({ cwd, noExit: true, silent: true })!;
    assert.equal(initial.issues.find(issue => issue.type === 'orphan_edges')?.evidence_count, 1);
    writeHealthBaseline(pmemPath, initial.issues);

    insertOrphan('missing.two', 'missing.target');
    const regressed = verifyCommand({ cwd, noExit: true, silent: true })!;
    const orphan = regressed.issues.find(issue => issue.type === 'orphan_edges');
    assert.equal(orphan?.evidence_count, 2);
    assert.equal(orphan?.historical, false);
    assert.ok(regressed.change_score !== null && regressed.change_score < 100);
  });
});
