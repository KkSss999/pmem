import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { ensureDir } from '../core/fs';
import { Pmem } from './index';
import type {
  BackendCapabilities,
  BackendOpenContext,
  BackendQuery,
  BackendTransaction,
  BackendTransactionOptions,
  MemoryBackend,
  MemoryEvent,
  MemoryQueryResult,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
} from './model';

const capabilities: BackendCapabilities = {
  transactions: { atomic: true, isolation: 'serializable' },
  query: { structured: true, fulltext: true, graph: true, semantic: false },
  relations: true,
  search_index: true,
};

class RecordingBackend implements MemoryBackend {
  readonly id = 'test-backend';
  readonly capabilities = capabilities;
  opened = false;
  closed = false;
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  failAppend = false;

  open(_context: BackendOpenContext): void { this.opened = true; }
  close(): void { this.closed = true; }
  getRecord(_id: string): null { return null; }
  query(_query: BackendQuery): MemoryQueryResult { return { records: [] }; }
  search(_request: MemorySearchRequest): MemorySearchResult { return { hits: [] }; }
  beginTransaction(_options?: BackendTransactionOptions): BackendTransaction {
    this.beginCount++;
    const owner = this;
    return {
      id: `tx-${this.beginCount}`,
      atomic: true,
      getRecord: async (_id: string): Promise<MemoryRecord | null> => null,
      putRecord: async (_record: MemoryRecord): Promise<void> => undefined,
      deleteRecord: async (_id: string, _event?: MemoryEvent): Promise<void> => undefined,
      appendEvent: async (event: MemoryEvent): Promise<MemoryEvent> => {
        if (owner.failAppend) throw new Error('injected append failure');
        return event;
      },
      putRelation: async () => undefined,
      removeRelation: async () => undefined,
      upsertSearchDocument: async () => undefined,
      query: async (_query: BackendQuery): Promise<MemoryQueryResult> => ({ records: [] }),
      commit: async () => { owner.commitCount++; },
      rollback: async () => { owner.rollbackCount++; },
    };
  }
}

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-runtime-tx-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('transaction-test'));
  return root;
}

test('Pmem routes observe through an injected backend transaction and lifecycle', async () => {
  const root = makeProject();
  const backend = new RecordingBackend();
  const memory = await Pmem.open({ root, backend });
  try {
    assert.equal(backend.opened, true);
    const receipt = await memory.observe({ summary: 'transactional observation' });
    assert.equal(receipt.type, 'observe');
    assert.equal(backend.beginCount, 1);
    assert.equal(backend.commitCount, 1);
    assert.equal(backend.rollbackCount, 0);
  } finally {
    await memory.close();
    assert.equal(backend.closed, true);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pmem does not create a hidden SQLite backend for a non-SQLite backend', async () => {
  const root = makeProject();
  const backend = new RecordingBackend();
  const memory = await Pmem.open({ root, backend });
  try {
    await memory.observe({ summary: 'portable event' });
    await assert.rejects(() => memory.recall(), /LegacyCompatibilityRequired/);
    assert.equal(backend.beginCount, 1);
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('Pmem rolls back an injected backend transaction when append fails', async () => {
  const root = makeProject();
  const backend = new RecordingBackend();
  backend.failAppend = true;
  const memory = await Pmem.open({ root, backend });
  try {
    await assert.rejects(() => memory.observe({ summary: 'must rollback' }), /injected append failure/);
    assert.equal(backend.beginCount, 1);
    assert.equal(backend.commitCount, 0);
    assert.equal(backend.rollbackCount, 1);
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
