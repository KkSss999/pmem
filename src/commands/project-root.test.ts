import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

describe('project-root CLI discovery', () => {
  it('runs rebuild and new from a source subdirectory and from .pmem', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-cli-root-'));
    run(['init', 'root-test', '--guided', '--description', 'test', '--stage', 'test', '--next', 'test'], root);

    const nested = path.join(root, 'src', 'feature');
    fs.mkdirSync(nested, { recursive: true });
    run(['rebuild'], nested);
    run(['new', 'module', 'Nested module', '--id', 'nested'], nested);
    run(['rebuild'], path.join(root, '.pmem'));

    assert.ok(fs.existsSync(path.join(root, '.pmem', 'modules', 'module.nested.md')));
    assert.ok(!fs.existsSync(path.join(root, '.pmem', '.pmem')));
  });
});
