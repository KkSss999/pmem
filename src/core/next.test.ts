import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { writeManagedNext, readNext } from './next';

function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-next-test-'));
  fs.mkdirSync(path.join(dir, '.pmem'), { recursive: true });
  return dir;
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

test('writeManagedNext partial write preserves prior ## Why and ## Needed Context', () => {
  const cwd = process.cwd();
  process.chdir(mkTmpDir());
  try {
    const pmemPath = path.join(process.cwd(), '.pmem');

    // Seed a fully-curated next.md
    writeManagedNext(pmemPath, {
      nextStep: 'Step A',
      why: 'Manually written rationale.',
      context: ['[[card-alpha]]', '[[card-beta]]']
    });

    const seeded = readNext(pmemPath);
    assert.equal(seeded.nextStep, 'Step A');
    assert.equal(seeded.why, 'Manually written rationale.');
    assert.deepEqual(seeded.context, ['[[card-alpha]]', '[[card-beta]]']);

    // Partial write: only nextStep changes; why/context should be preserved.
    const merged = writeManagedNext(pmemPath, {
      nextStep: 'Step B'
    });

    assert.equal(merged.nextStep, 'Step B');
    assert.equal(merged.why, 'Manually written rationale.');
    assert.deepEqual(merged.context, ['[[card-alpha]]', '[[card-beta]]']);

    // Round-trip via readNext
    const reread = readNext(pmemPath);
    assert.equal(reread.nextStep, 'Step B');
    assert.equal(reread.why, 'Manually written rationale.');
    assert.deepEqual(reread.context, ['[[card-alpha]]', '[[card-beta]]']);
  } finally {
    process.chdir(cwd);
    rmTmp(path.join(process.cwd(), '.pmem')); // no-op safety
  }
});

test('writeManagedNext with replaceManaged:true wipes prior ## Why and ## Needed Context', () => {
  const cwd = process.cwd();
  const dir = mkTmpDir();
  process.chdir(dir);
  try {
    const pmemPath = path.join(dir, '.pmem');

    writeManagedNext(pmemPath, {
      nextStep: 'Step A',
      why: 'Old why.',
      context: ['old-1', 'old-2']
    });

    const merged = writeManagedNext(pmemPath, {
      nextStep: 'Step B',
      why: 'Fresh why.',
      context: ['fresh-1'],
      replaceManaged: true
    });

    assert.equal(merged.nextStep, 'Step B');
    assert.equal(merged.why, 'Fresh why.');
    assert.deepEqual(merged.context, ['fresh-1']);

    // Verify disk state too
    const reread = readNext(pmemPath);
    assert.equal(reread.nextStep, 'Step B');
    assert.equal(reread.why, 'Fresh why.');
    assert.deepEqual(reread.context, ['fresh-1']);
  } finally {
    process.chdir(cwd);
    rmTmp(dir);
  }
});

test('writeManagedNext on a fresh (non-existent) next.md starts from defaults', () => {
  const cwd = process.cwd();
  const dir = mkTmpDir();
  process.chdir(dir);
  try {
    const pmemPath = path.join(dir, '.pmem');

    // No prior next.md exists
    const merged = writeManagedNext(pmemPath, {
      nextStep: 'Brand new step'
    });

    assert.equal(merged.nextStep, 'Brand new step');
    // No prior state means why/context are undefined
    assert.equal(merged.why, undefined);
    assert.equal(merged.context, undefined);

    // File should now exist and round-trip
    const nextPath = path.join(pmemPath, 'next.md');
    assert.equal(fs.existsSync(nextPath), true);

    const reread = readNext(pmemPath);
    assert.equal(reread.nextStep, 'Brand new step');
  } finally {
    process.chdir(cwd);
    rmTmp(dir);
  }
});

test('writeManagedNext preserves [[card-id]] wikilinks across partial writes', () => {
  const cwd = process.cwd();
  const dir = mkTmpDir();
  process.chdir(dir);
  try {
    const pmemPath = path.join(dir, '.pmem');

    writeManagedNext(pmemPath, {
      nextStep: 'Investigate [[card-x]]',
      why: 'Why we care about [[card-x]].',
      context: ['[[card-x]]', '[[card-y]]', '[[card-z]]']
    });

    // Partial: only nextStep
    writeManagedNext(pmemPath, { nextStep: 'Update [[card-x]] docs' });

    const reread = readNext(pmemPath);
    assert.equal(reread.nextStep, 'Update [[card-x]] docs');
    assert.equal(reread.why, 'Why we care about [[card-x]].');
    assert.deepEqual(reread.context, ['[[card-x]]', '[[card-y]]', '[[card-z]]']);

    // Partial: only context updates, why preserved
    writeManagedNext(pmemPath, {
      nextStep: 'Finalize [[card-x]]',
      context: ['[[card-x]]', '[[card-w]]']
    });

    const final = readNext(pmemPath);
    assert.equal(final.nextStep, 'Finalize [[card-x]]');
    assert.equal(final.why, 'Why we care about [[card-x]].');
    assert.deepEqual(final.context, ['[[card-x]]', '[[card-w]]']);
  } finally {
    process.chdir(cwd);
    rmTmp(dir);
  }
});