import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatusPorcelain } from './git';

test('parseGitStatusPorcelain preserves paths for modified files with leading status space', () => {
  const changes = parseGitStatusPorcelain(' M src/index.ts\n');

  assert.deepEqual(changes, [
    { status: 'M', path: 'src/index.ts' },
  ]);
});

test('parseGitStatusPorcelain handles added, untracked, and renamed files', () => {
  const changes = parseGitStatusPorcelain([
    'A  src/new.ts',
    '?? README.md',
    'R  src/old.ts -> src/current.ts',
  ].join('\n'));

  assert.deepEqual(changes, [
    { status: 'A', path: 'src/new.ts' },
    { status: '??', path: 'README.md' },
    { status: 'R', path: 'src/current.ts' },
  ]);
});

