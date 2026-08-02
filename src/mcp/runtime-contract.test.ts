import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Pmem } from '../runtime';
import { SchemaRegistry } from '../schema';
import { SqliteMemoryBackend } from '../storage';
import { handleMcpTool } from './server';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('MCP canonical Runtime boundary', () => {
  it('routes JSON MCP requests through a Pmem.open backend/schema instance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-runtime-contract-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const registry = new SchemaRegistry();
    // SchemaRegistry.register() returns `this` for fluent registration; the
    // Runtime port only needs the read-only resolve/list surface here.
    const schema = { resolve: (ref: { id: string; version: string }) => registry.resolve(ref), list: () => registry.list() };
    const runtime = await Pmem.open({ root, backend, schema });
    try {
      assert.equal(runtime.backend, backend);
      const response = await handleMcpTool(runtime, 'readonly', 'pmem_ask', { query: 'canonical boundary' });
      assert.equal(response.isError, undefined);
      assert.equal(response.content[0]?.type, 'text');
      assert.match(response.content[0]?.text ?? '', /canonical boundary/);
    } finally {
      await runtime.close();
    }
  });
});
