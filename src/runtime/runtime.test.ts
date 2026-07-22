import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { ensureDir, writeFile } from '../core/fs';
import { loadRuntimeConfig } from './config';
import { EventStore } from './event-store';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { Pmem } from './index';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-runtime-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('runtime-test'));
  writeFile(path.join(pmemPath, 'index.md'), '# runtime-test\n\nName: runtime-test\n\n## Current Focus\nRuntime tests\n');
  writeFile(path.join(pmemPath, 'state.md'), '# State\n\n## Overall Status\n- active\n');
  writeFile(path.join(pmemPath, 'next.md'), '# Next\n\n## Recommended Next Step\nContinue runtime tests.\n');
  return root;
}

test('loadRuntimeConfig merges software defaults and overrides', () => {
  const root = makeProject();
  const config = loadRuntimeConfig(root, 'software', { working: { ttl: '1h' }, durable: { confirmation: 'optional' } });
  assert.equal(config.preset, 'software');
  assert.equal(config.branchAware, true);
  assert.equal(config.working.ttl, '1h');
  assert.equal(config.durable.format, 'markdown');
  assert.equal(config.durable.confirmation, 'optional');
});

test('ScopeManager resolves explicit, session, and project scopes', () => {
  const root = makeProject();
  const config = loadRuntimeConfig(root, 'software', { branchAware: false });
  const scope = new ScopeManager(root, config);
  assert.equal(scope.resolve('', { metadata: { scope: 'private:agent-a' } }), 'private:agent-a');
  assert.equal(scope.resolve('', { metadata: { session_id: 's1' } }), 'session:s1');
  assert.equal(scope.resolve('src/index.ts', {}), 'project');
  assert.equal(scope.isVisible('private:agent-a', 'agent-b'), false);
});

test('PolicyEngine applies confirmation and TTL rules', () => {
  const config = loadRuntimeConfig(makeProject(), 'software', { working: { ttl: '1ms' } });
  const policy = new PolicyEngine(config);
  assert.equal(policy.requiresConfirmation({ type: 'observe', scope: 'project', summary: 'change' }), true);
  assert.equal(policy.isExpired({
    filePath: '.pmem/traces/old.md',
    body: 'old',
    frontmatter: {
      id: 'trace.old',
      type: 'trace',
      updated: '2000-01-01T00:00:00.000Z',
    },
  }), true);
});

test('EventStore appends, replays, and returns working memory', () => {
  const db = new Database(':memory:');
  const events = new EventStore(db, '1h');
  const receipt = events.append({ type: 'observe', scope: 'project', payload: { summary: 'observed' } });
  assert.equal(receipt.type, 'observe');
  assert.equal(events.replay().length, 1);
  const working = events.working('project');
  assert.equal(working.scope, 'project');
  assert.equal(working.events[0].payload.summary, 'observed');
  db.close();
});

test('Pmem.open exposes runtime query and event APIs', async () => {
  const root = makeProject();
  const memory = await Pmem.open({ root });
  try {
    const recall = await memory.recall({ noTraces: true });
    assert.equal(recall.project, 'runtime-test');
    const receipt = await memory.observe({ file: 'src/runtime/index.ts', summary: 'runtime observed' });
    assert.equal(receipt.type, 'observe');
    assert.equal(receipt.requires_confirmation, true);
    const tombstone = await memory.forget({ id: receipt.id, reason: 'runtime forgotten' });
    assert.equal(tombstone.type, 'forget');
    assert.equal(tombstone.scope, receipt.scope);
    const db = new Database(path.join(root, '.pmem', 'pmem.db'));
    try {
      const events = new EventStore(db, '1h');
      assert.equal(events.replay().at(-1)?.payload.target_id, receipt.id);
    } finally {
      db.close();
    }
  } finally {
    await memory.close();
  }
});
