import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Pmem } from '../runtime';
import { SchemaRegistry } from '../schema';
import { SqliteMemoryBackend } from '../storage';
import { handleMcpTool, listMcpTools } from './server';
import { MCP_SCHEMA_VERSION } from '../version';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('MCP ContextPack surface', () => {
  it('advertises pmem_context_pack in read-only mode', () => {
    assert.ok(listMcpTools('readonly').some(tool => tool.name === 'pmem_context_pack'));
  });

  it('returns the canonical ContextPack wire shape', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-context-pack-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const registry = new SchemaRegistry();
    const schema = { resolve: (ref: { id: string; version: string }) => registry.resolve(ref), list: () => registry.list() };
    const runtime = await Pmem.open({ root, backend, schema });
    try {
      const response = await handleMcpTool(runtime, 'readonly', 'pmem_context_pack', {
        query: 'recover deployment',
        budget: 128,
      });
      assert.equal(response.isError, undefined);
      const payload = JSON.parse(response.content[0]?.text ?? '{}');
      assert.equal(payload.schemaVersion, '1');
      assert.equal(payload.query, 'recover deployment');
      assert.equal(payload.budget.requestedTokens, 128);
      assert.equal(payload.schema_version, MCP_SCHEMA_VERSION);
    } finally {
      await runtime.close();
    }
  });

  it('rejects a missing query before invoking the Runtime', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-context-pack-missing-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const runtime = await Pmem.open({ root, backend });
    try {
      const response = await handleMcpTool(runtime, 'readonly', 'pmem_context_pack', {});
      assert.equal(response.isError, true);
      assert.match(response.content[0]?.text ?? '', /query.*required/i);
    } finally {
      await runtime.close();
    }
  });

  it('rejects invalid numeric options and unknown keys', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-context-pack-invalid-'));
    roots.push(root);
    const runtime = await Pmem.open({ root, backend: new SqliteMemoryBackend(path.join(root, '.pmem')) });
    try {
      const negative = await handleMcpTool(runtime, 'readonly', 'pmem_context_pack', { query: 'q', budget: -1 });
      assert.equal(negative.isError, true);
      assert.match(negative.content[0]?.text ?? '', /budget.*finite non-negative/i);
      const unknown = await handleMcpTool(runtime, 'readonly', 'pmem_context_pack', { query: 'q', extra: true });
      assert.equal(unknown.isError, true);
      assert.match(unknown.content[0]?.text ?? '', /unknown parameter/i);
    } finally {
      await runtime.close();
    }
  });
});
