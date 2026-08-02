import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProjectPaths, resolveProjectPaths } from './projectRoot';

function tempProject(): { root: string; pmemPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-project-root-'));
  const pmemPath = path.join(root, '.pmem');
  fs.mkdirSync(pmemPath);
  return { root, pmemPath };
}

test('findProjectPaths walks up from project subdirectories', () => {
  const { root, pmemPath } = tempProject();
  const nested = path.join(root, 'src', 'feature');
  fs.mkdirSync(nested, { recursive: true });

  assert.deepEqual(findProjectPaths(nested), { projectRoot: root, pmemPath, cwd: nested });
});

test('findProjectPaths treats .pmem itself as project content, not a nested project', () => {
  const { root, pmemPath } = tempProject();
  const cards = path.join(pmemPath, 'modules');
  fs.mkdirSync(cards);

  assert.deepEqual(findProjectPaths(pmemPath), { projectRoot: root, pmemPath, cwd: pmemPath });
  assert.deepEqual(findProjectPaths(cards)?.pmemPath, pmemPath);
  assert.equal(resolveProjectPaths(cards).projectRoot, root);
});

test('resolveProjectPaths explains when no project is found', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-no-project-'));
  assert.throws(() => resolveProjectPaths(cwd), /Walked upward looking for a \.pmem directory/);
});

test('does not cross a nested Git repository boundary to an outer pmem project', () => {
  const outer = tempProject();
  const nested = path.join(outer.root, 'child');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });

  assert.equal(findProjectPaths(nested), null);
});
