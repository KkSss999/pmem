import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { SchemaRegistry } from '../schema';
import { SqliteMemoryBackend } from '../storage';
import { openCommandRuntime } from './runtime';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});
describe('CLI command Runtime injection boundary', () => {
  it('opens command Runtime with injected backend/schema while preserving v1.2 root semantics', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-command-runtime-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const registry = new SchemaRegistry();
    const schema = { resolve: (ref: { id: string; version: string }) => registry.resolve(ref), list: () => registry.list() };
    const runtime = await openCommandRuntime(root, { backend, schema });
    try {
      assert.equal(runtime.backend, backend);
      assert.equal(runtime.root, root);
    } finally {
      await runtime.close();
    }
  });
});
