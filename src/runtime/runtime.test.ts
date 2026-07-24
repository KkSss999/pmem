import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { ensureDir, writeFile } from '../core/fs';
import { loadRuntimeConfig } from './config';
import { EventStore } from './event-store';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { Pmem } from './index';
import { createSchema, upsertCard } from '../core/db';
import { rebuildSemanticIndex } from '../core/semantic';
import type { CardRow } from '../types';

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
test('Pmem keeps status, capture, recall, and context rooted after process.chdir', async () => {
  const root = makeProject();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-runtime-elsewhere-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  execSync('git init -q', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  execSync('git config user.name "test"', { cwd: root });
  execSync('git checkout -q -b runtime-root-x', { cwd: root });
  writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n');

  const memory = await Pmem.open({ root });
  const previous = process.cwd();
  process.chdir(elsewhere);
  try {
    const status = await memory.status();
    assert.equal(status.source, 'git');
    assert.ok(status.changes.some(change => change.path === 'src/index.ts'));

    const capture = await memory.capture('cross cwd runtime capture', { force: true });
    assert.equal(capture.success, true, capture.message);
    assert.ok(capture.tracePath?.startsWith(path.join(root, '.pmem', 'traces')));
    assert.match(fs.readFileSync(capture.tracePath!, 'utf8'), /src\/index\.ts/);

    const recall = await memory.recall({ recent: 1 });
    assert.match(recall.recent_traces?.[0]?.file_path ?? '', /^\.pmem\/traces\//);
    assert.ok(recall.recent_events?.some(event => event.branch === 'runtime-root-x'));

    const context = await memory.context('cross cwd branch event');
    assert.ok(context.changed_files.some(change => change.path === 'src/index.ts'));
    assert.match((context.recent_session_memory ?? []).join('\n'), /runtime-root-x/);
  } finally {
    process.chdir(previous);
    await memory.close();
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});


test('two same-root Pmem instances keep independent DB handles after one closes', async () => {
  const root = makeProject();
  const first = await Pmem.open({ root });
  const second = await Pmem.open({ root });
  try {
    await first.close();
    const receipt = await second.observe({ summary: 'still usable after first close' });
    assert.equal(receipt.type, 'observe');
    const recall = await second.recall({ noTraces: true });
    assert.equal(recall.project, 'runtime-test');
  } finally {
    await first.close();
    await second.close();
  }
});

test('Pmem ask and context reject an unverified semantic cache and degrade deterministically', async () => {
  const root = makeProject();
  const pmemPath = path.join(root, '.pmem');
  const manifest = getDefaultManifest('runtime-test');
  manifest.embedding = {
    enabled: true,
    provider: 'local',
    model: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    source: 'modelscope',
    dtype: 'uint8',
    cache_path: path.join(root, 'missing-cache'),
    dimension: 384,
    store: 'sqlite',
    index: 'flat',
  };
  saveManifest(pmemPath, manifest);
  const db = new Database(path.join(pmemPath, 'pmem.db'));
  createSchema(db);
  const row: CardRow = {
    id: 'decision.cache_guard', type: 'decision', title: 'Cache Guard', status: 'active', priority: null,
    file_path: '.pmem/decisions/decision.cache_guard.md', summary: 'Deterministic fallback card',
    schema_version: '0.3', card_version: 1, created_at: null, updated_at: null, last_verified_at: null,
    file_hash: 'f', frontmatter_hash: 'fm', body_hash: 'b', token_count: 1, section_count: 1,
    is_deleted: 0, is_candidate: 0, trust_label: 'user_confirmed', sensitivity: 'internal',
  };
  upsertCard(db, row);
  await rebuildSemanticIndex(db, [{
    id: row.id, title: row.title, summary: row.summary, body: '# Cache Guard\nverified fallback',
    frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
  }], {
    modelId: manifest.embedding.model!, revision: manifest.embedding.revision!, dimension: 384,
    async embedPassages(texts) { return texts.map(() => Array(384).fill(1)); },
    async embedQuery() { return Array(384).fill(1); },
  }, { mode: 'full' });
  db.close();

  const memory = await Pmem.open({ root });
  try {
    const ask = await memory.ask('Cache Guard');
    assert.equal(ask.matched[0]?.id, row.id);
    assert.match(ask.warnings?.[0] ?? '', /cache is missing/i);
    const context = await memory.context('Cache Guard');
    assert.ok(context.relevant_memory.some(card => card.id === row.id));
    assert.ok(context.warnings.some(warning => /cache is missing/i.test(warning)));
  } finally {
    await memory.close();
  }
});
