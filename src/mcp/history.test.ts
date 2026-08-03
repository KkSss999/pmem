import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Pmem } from '../runtime';
import { SqliteMemoryBackend } from '../storage';
import { handleMcpTool, listMcpTools } from './server';
import { MCP_SCHEMA_VERSION } from '../version';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});
describe('MCP Memory History surface', () => {
  it('advertises history and diff as read-only tools', () => {
    const names = listMcpTools('readonly').map(tool => tool.name);
    assert.ok(names.includes('pmem_history'));
    assert.ok(names.includes('pmem_diff'));
    assert.deepEqual(listMcpTools('append-only').filter(tool => tool.name === 'pmem_history' || tool.name === 'pmem_diff').map(tool => tool.name), ['pmem_history', 'pmem_diff']);
  });

  it('routes history and diff through Runtime and preserves the MCP envelope', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-history-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const runtime = await Pmem.open({ root, backend });
    const tx = backend.beginTransaction();
    tx.appendEvent({
      id: 'history-before', type: 'commit', scope: 'project',
      occurred_at: '2026-08-03T10:00:00.000Z', recorded_at: '2026-08-03T10:00:00.000Z',
      record_id: 'memory.database', payload: { summary: 'mysql' },
    });
    tx.appendEvent({
      id: 'history-after', type: 'commit', scope: 'project',
      occurred_at: '2026-08-03T11:00:00.000Z', recorded_at: '2026-08-03T11:00:00.000Z',
      record_id: 'memory.database', payload: {
        summary: 'postgres',
        changes: [{ path: 'content.database', before: 'mysql', after: 'postgres' }],
      },
    });
    tx.commit();
    try {
      const history = await handleMcpTool(runtime, 'readonly', 'pmem_history', {
        id: 'memory.database', from: '2026-08-03T09:00:00.000Z', limit: 10,
      });
      assert.equal(history.isError, undefined);
      const historyBody = JSON.parse(history.content[0]?.text ?? '{}');
      assert.equal(historyBody.schema_version, MCP_SCHEMA_VERSION);
      assert.equal(historyBody.memoryId, 'memory.database');
      assert.deepEqual(historyBody.entries.map((entry: any) => entry.eventId), ['1', '2']);
      assert.equal(historyBody.entries[1].diffStatus, 'available');

      const diff = await handleMcpTool(runtime, 'readonly', 'pmem_diff', { id: 'memory.database' });
      assert.equal(diff.isError, undefined);
      const diffBody = JSON.parse(diff.content[0]?.text ?? '{}');
      assert.equal(diffBody.schema_version, MCP_SCHEMA_VERSION);
      assert.equal(diffBody.diffStatus, 'available');
      assert.deepEqual(diffBody.changes, [{ path: 'content.database', before: 'mysql', after: 'postgres' }]);
    } finally {
      await runtime.close();
    }
  });

  it('rejects malformed history/diff inputs without invoking a write path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-history-invalid-'));
    roots.push(root);
    const runtime = await Pmem.open({ root, backend: new SqliteMemoryBackend(path.join(root, '.pmem')) });
    try {
      const missing = await handleMcpTool(runtime, 'readonly', 'pmem_history', {});
      assert.equal(missing.isError, true);
      assert.match(missing.content[0]?.text ?? '', /id.*required/i);
      const badLimit = await handleMcpTool(runtime, 'readonly', 'pmem_history', { id: 'memory.x', limit: 0 });
      assert.equal(badLimit.isError, true);
      assert.match(badLimit.content[0]?.text ?? '', /limit.*1.*500/i);
      const reversed = await handleMcpTool(runtime, 'readonly', 'pmem_history', {
        id: 'memory.x', from: '2026-08-04T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z',
      });
      assert.equal(reversed.isError, true);
      assert.match(reversed.content[0]?.text ?? '', /from.*later.*to/i);
      const unknown = await handleMcpTool(runtime, 'readonly', 'pmem_diff', { id: 'memory.x', extra: true });
      assert.equal(unknown.isError, true);
      assert.match(unknown.content[0]?.text ?? '', /unknown parameter/i);
    } finally {
      await runtime.close();
    }
  });

  it('filters private and session events by the Runtime principal before MCP serialization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-mcp-history-scope-'));
    roots.push(root);
    const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
    const runtime = await Pmem.open({ root, backend });
    const tx = backend.beginTransaction();
    for (const [id, scope] of [['project', 'project'], ['private', 'private:agent-a'], ['session', 'session:s1']] as const) {
      tx.appendEvent({
        id, type: 'commit', scope, occurred_at: `2026-08-03T${id === 'project' ? '10' : id === 'private' ? '11' : '12'}:00:00.000Z`,
        recorded_at: `2026-08-03T${id === 'project' ? '10' : id === 'private' ? '11' : '12'}:00:00.000Z`,
        record_id: 'memory.scoped', payload: { summary: id },
      });
    }
    tx.commit();
    try {
      const response = await handleMcpTool(runtime, 'readonly', 'pmem_history', { id: 'memory.scoped' });
      assert.equal(response.isError, undefined);
      const body = JSON.parse(response.content[0]?.text ?? '{}');
      assert.deepEqual(body.entries.map((entry: any) => entry.eventId), ['1']);
      const ownerResponse = await handleMcpTool(runtime, 'readonly', 'pmem_history', { id: 'memory.scoped', principal: 'agent-a' });
      const ownerBody = JSON.parse(ownerResponse.content[0]?.text ?? '{}');
      assert.deepEqual(ownerBody.entries.map((entry: any) => entry.eventId), ['1', '2']);
    } finally {
      await runtime.close();
    }
  });
});
