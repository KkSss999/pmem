import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathMatch } from './fs';

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
