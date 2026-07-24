import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHealthBaseline, writeHealthBaseline } from './baseline';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('health baseline', () => {
  it('is missing until explicitly written and round-trips accepted issues', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-baseline-'));
    roots.push(root);
    const pmemPath = path.join(root, '.pmem');
    fs.mkdirSync(pmemPath);
    assert.equal(readHealthBaseline(pmemPath).status, 'missing');
    writeHealthBaseline(pmemPath, [{ severity: 'warning', type: 'stale_memory', card_id: 'module.core', message: 'x', fix: 'x' }], new Date('2026-01-01T00:00:00Z'));
    const loaded = readHealthBaseline(pmemPath);
    assert.equal(loaded.status, 'loaded');
    assert.equal(loaded.value?.entries.length, 1);
    assert.equal(loaded.value?.entries[0].fingerprint, 'stale_memory:module.core');
  });

  it('marks corrupt baseline files invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-baseline-'));
    roots.push(root);
    const pmemPath = path.join(root, '.pmem');
    fs.mkdirSync(pmemPath);
    fs.writeFileSync(path.join(pmemPath, 'health-baseline.json'), '{}');
    assert.equal(readHealthBaseline(pmemPath).status, 'invalid');
  });

  it('rejects a baseline copied from a different project', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-source-'));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-target-'));
    roots.push(sourceRoot, targetRoot);
    const source = path.join(sourceRoot, '.pmem');
    const target = path.join(targetRoot, '.pmem');
    fs.mkdirSync(source);
    fs.mkdirSync(target);
    writeHealthBaseline(source, []);
    fs.copyFileSync(path.join(source, 'health-baseline.json'), path.join(target, 'health-baseline.json'));
    assert.equal(readHealthBaseline(target).status, 'invalid');
  });
});
