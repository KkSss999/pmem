import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRetrieverRegistry, createQueryPlan, RetrieverRegistry } from './registry';
import type { BackendCapabilities, MemoryBackend, MemoryRecord } from '../runtime/model';

const caps: BackendCapabilities = {
  transactions: { atomic: true },
  query: { structured: true, fulltext: true, graph: true, semantic: false },
  relations: true,
  search_index: true,
};

const record = (id: string, title: string): MemoryRecord => ({
  id,
  schema: { id: 'memory', version: '1.0.0' },
  data: { title },
  scope: 'project',
  provenance: { source: 'test' },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

function backend(overrides: Partial<MemoryBackend> = {}): MemoryBackend {
  return {
    id: 'registry-test',
    capabilities: caps,
    open: async () => undefined,
    close: async () => undefined,
    getRecord: async () => null,
    query: async () => ({ records: [record('memory.a', 'Alpha')] }),
    search: async () => ({ hits: [{ record_id: 'memory.b', score: 0.7, channels: ['fts'] }] }),
    beginTransaction: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

test('default registry executes deterministic stages, merges duplicate hits, and packs', async () => {
  const registry = createDefaultRetrieverRegistry();
  const result = await registry.execute({ backend: backend(), plan: createQueryPlan('Alpha', 1) });
  assert.ok(result.executed.includes('exact'));
  assert.ok(result.executed.includes('structured'));
  assert.ok(result.executed.includes('lexical'));
  assert.ok(result.executed.includes('rerank'));
  assert.ok(result.executed.includes('packing'));
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.id, 'memory.a');
  assert.equal(result.skipped.includes('semantic'), true);
});

test('registry skips unavailable channels and degrades on retriever failure', async () => {
  const registry = new RetrieverRegistry()
    .register({
      id: 'lexical',
      supports: () => true,
      retrieve: async () => { throw new Error('index unavailable'); },
    });
  const result = await registry.execute({
    backend: backend({ capabilities: { ...caps, query: { ...caps.query, fulltext: true } } }),
    plan: { text: 'x', stages: ['lexical', 'semantic', 'packing'], limit: 10, deterministic: true },
  });
  assert.equal(result.hits.length, 0);
  assert.ok(result.warnings?.some(warning => warning.includes('index unavailable')));
  assert.ok(result.skipped.includes('semantic'));
});

test('registry selects every capability channel and preserves source channels while merging', async () => {
  const records: Record<string, MemoryRecord> = {
    'memory.exact': record('memory.exact', 'Exact'),
    'memory.structured': record('memory.structured', 'Structured'),
    'memory.graph': record('memory.graph', 'Graph'),
  };
  const result = await createDefaultRetrieverRegistry().execute({
    backend: backend({
      getRecord: async id => records[id] ?? null,
      query: async query => query.relation
        ? { records: [records['memory.graph']] }
        : query.filters?.[0]?.field === 'id'
          ? { records: [records['memory.exact']] }
          : { records: [records['memory.structured']] },
      search: async () => ({ hits: [
        { record_id: 'memory.exact', score: 0.75, channels: ['fts'] },
        { record_id: 'memory.semantic', score: 0.95, channels: ['vector'] },
      ]}),
      capabilities: { ...caps, query: { ...caps.query, semantic: true } },
    }),
    plan: { text: 'memory.exact', stages: ['exact', 'structured', 'lexical', 'graph', 'semantic', 'rerank', 'packing'], limit: 10, deterministic: true },
  });

  assert.deepEqual(result.executed, ['exact', 'structured', 'lexical', 'graph', 'semantic', 'rerank', 'packing']);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(result.hits.map(hit => hit.id), ['memory.exact', 'memory.semantic', 'memory.structured', 'memory.graph']);
  assert.deepEqual(result.hits.find(hit => hit.id === 'memory.exact')?.channels, ['exact', 'lexical', 'fts', 'semantic']);
  assert.equal(result.hits.find(hit => hit.id === 'memory.semantic')?.record?.data.title, undefined);
});

test('graph channel explicitly warns and returns no fabricated records when relation queries are unavailable', async () => {
  const result = await createDefaultRetrieverRegistry().execute({
    backend: backend({
      capabilities: { ...caps, query: { ...caps.query, graph: true }, relations: true },
      query: async query => {
        if (query.relation) throw new Error('relation query unsupported by backend');
        return { records: [] };
      },
    }),
    plan: { text: 'memory.source', stages: ['graph', 'packing'], limit: 5, deterministic: true },
  });
  assert.deepEqual(result.hits, []);
  assert.ok(result.warnings?.some(warning => warning.includes('graph retriever skipped')));
});

test('graph channel is skipped with a warning when backend lacks relation capability', async () => {
  const result = await createDefaultRetrieverRegistry().execute({
    backend: backend({ capabilities: { ...caps, query: { ...caps.query, graph: false }, relations: false } }),
    plan: { text: 'memory.source', stages: ['graph'], limit: 5, deterministic: true },
  });
  assert.deepEqual(result.hits, []);
  assert.deepEqual(result.skipped, ['graph']);
  assert.ok(result.warnings?.[0]?.includes('backend does not support relation queries'));
});

test('registry keeps deterministic id ordering when rerank scores tie and packing enforces limit', async () => {
  const registry = new RetrieverRegistry().register({
    id: 'lexical',
    supports: () => true,
    retrieve: async () => ({ hits: [
      { id: 'memory.b', score: 0.5, channels: ['lexical'] },
      { id: 'memory.a', score: 0.5, channels: ['lexical'] },
      { id: 'memory.c', score: 0.4, channels: ['lexical'] },
    ] }),
  });
  const result = await registry.execute({ backend: backend(), plan: { text: 'x', stages: ['lexical', 'rerank', 'packing'], limit: 2, deterministic: true } });
  assert.deepEqual(result.hits.map(hit => hit.id), ['memory.a', 'memory.b']);
});
