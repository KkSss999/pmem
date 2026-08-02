import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isPathMatch, withLock } from './fs';

test('isPathMatch matches exact file paths', () => {
  assert.equal(isPathMatch('src/index.ts', 'src/index.ts'), true);
  assert.equal(isPathMatch('src/index.ts', 'src/commands.ts'), false);
  assert.equal(isPathMatch('v064/.pmem/index.md', '.pmem/index.md'), false);
});

test('isPathMatch matches files inside target directories', () => {
  assert.equal(isPathMatch('src/commands/status.ts', 'src/commands'), true);
  assert.equal(isPathMatch('src/commands/status.ts', 'src/commands/'), true);
  assert.equal(isPathMatch('src/commands/status.ts', 'src'), true);
  assert.equal(isPathMatch('src/commands/status.ts', 'src/comm'), false);
  assert.equal(isPathMatch('src/commands-extra/status.ts', 'src/commands'), false);
});

test('isPathMatch handles trailing slashes correctly', () => {
  assert.equal(isPathMatch('src/commands/', 'src/commands'), true);
  assert.equal(isPathMatch('src/commands', 'src/commands/'), true);
  assert.equal(isPathMatch('src/commands/', 'src/commands/'), true);
});

test('withLock diagnoses a resolved pmem path with a live owner PID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-lock-diagnostic-'));
  const pmemPath = path.join(root, '.pmem');
  const lockPath = path.join(pmemPath, '.lock');
  fs.mkdirSync(lockPath, { recursive: true });
  // Avoid the reentrant path by using the parent process as the lock owner.
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.ppid));
  assert.throws(
    () => withLock(pmemPath, () => undefined, { timeoutMs: 80 }),
    new RegExp(`lock held by PID ${process.ppid} \\(active\\)`),
  );
});

test('withLock diagnoses an unresolved pmem path separately from contention', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-lock-path-'));
  assert.throws(
    () => withLock(path.join(root, '.pmem'), () => undefined, { timeoutMs: 40 }),
    /pmem project path does not resolve to a \.pmem directory/,
  );
});
