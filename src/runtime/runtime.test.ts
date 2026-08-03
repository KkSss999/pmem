import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { getDefaultManifest, loadManifest, saveManifest } from '../core/manifest';
import { ensureDir, writeFile } from '../core/fs';
import { loadRuntimeConfig } from './config';
import { EventStore } from './event-store';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { Pmem } from './index';
import { openV12Pmem } from '../compatibility/v1_2_runtime';
import { createSchema, upsertCard } from '../core/db';
import { rebuildSemanticIndex } from '../core/semantic';
import { createSemanticEvidence } from '../core/semantic';
import { DEFAULT_SEMANTIC_MODEL, DEFAULT_SEMANTIC_MODEL_REVISION } from '../core/semantic/transformers';
import { SqliteMemoryBackend } from '../storage';
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

test('loadRuntimeConfig keeps Runtime defaults domain-neutral and applies overrides', () => {
  const root = makeProject();
  const config = loadRuntimeConfig(root, 'software', { working: { ttl: '1h' }, durable: { confirmation: 'optional' } });
  assert.equal(config.preset, 'software');
  assert.equal(config.branchAware, false);
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
  assert.equal(scope.resolve('src/index.ts', {}), 'workspace');
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
  const memory = await openV12Pmem({ root });
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

test('v1.3.1 opens the default semantic contract without requiring a model download', async () => {
  const root = makeProject();
  const memory = await openV12Pmem({ root });
  try {
    const manifest = loadManifest(path.join(root, '.pmem')) as any;
    assert.equal(manifest.embedding.enabled, true);
    assert.equal(manifest.embedding.auto_enabled, true);
    assert.equal(manifest.embedding.provider, 'local');
    assert.equal(manifest.embedding.model, DEFAULT_SEMANTIC_MODEL);
    assert.equal(manifest.embedding.revision, DEFAULT_SEMANTIC_MODEL_REVISION);
    assert.equal(manifest.embedding.dimension, 384);
    assert.ok(path.isAbsolute(manifest.embedding.cache_path));
  } finally {
    await memory.close();
  }
});

test('v1.3.1 preserves an explicit semantic opt-out across Runtime open', async () => {
  const root = makeProject();
  const pmemPath = path.join(root, '.pmem');
  const manifest = getDefaultManifest('runtime-test');
  manifest.embedding.auto_enabled = false;
  saveManifest(pmemPath, manifest);
  const memory = await openV12Pmem({ root });
  try {
    const persisted = loadManifest(pmemPath) as any;
    assert.equal(persisted.embedding.enabled, false);
    assert.equal(persisted.embedding.auto_enabled, false);
    assert.equal(persisted.embedding.provider, 'none');
  } finally {
    await memory.close();
  }
});

test('v1.3.2 keeps SQLite semantic retrieval deterministic-safe when the model cache is missing', async () => {
  const root = makeProject();
  const pmemPath = path.join(root, '.pmem');
  const manifest = getDefaultManifest('runtime-semantic-missing-cache');
  manifest.embedding.enabled = true;
  manifest.embedding.auto_enabled = true;
  manifest.embedding.cache_path = path.join(root, 'missing-semantic-model');
  saveManifest(pmemPath, manifest);
  const memory = await openV12Pmem({ root });
  try {
    assert.equal(memory.backend.capabilities.query.semantic, false);
    const result = await memory.ask('query without model cache');
    assert.ok(result.warnings?.some((warning: string) => warning.includes('degraded to deterministic recall')));
  } finally {
    await memory.close();
  }
});

test('Pmem.query executes a backend-neutral plan through the RetrieverRegistry', async () => {
  const root = makeProject();
  const memory = await openV12Pmem({ root });
  try {
    const now = new Date().toISOString();
    const tx = await memory.backend.beginTransaction();
    await tx.putRecord({
      id: 'memory.runtime-query',
      schema: { id: 'memory', version: '1.0.0' },
      data: { title: 'Runtime query record' },
      scope: 'project',
      provenance: { source: 'runtime-test' },
      created_at: now,
      updated_at: now,
    });
    await tx.commit();

    const result = await memory.query('memory.runtime-query', 1);
    assert.equal(result.hits[0]?.id, 'memory.runtime-query');
    assert.ok(result.executed.includes('exact'));
    assert.ok(result.executed.includes('packing'));
  } finally {
    await memory.close();
  }
});

test('Pmem.packContext converts ranked Runtime records into a deterministic ContextPack', async () => {
  const root = makeProject();
  const memory = await openV12Pmem({ root });
  try {
    const now = new Date().toISOString();
    const tx = await memory.backend.beginTransaction();
    await tx.putRecord({
      id: 'memory.context-pack',
      schema: { id: 'memory', version: '1.0.0' },
      data: { title: 'Payment timeout', content: 'Retry after timeout with bounded backoff.', type: 'decision' },
      scope: 'project',
      provenance: { source: 'runtime-test', source_id: 'decisions/payment-timeout.md' },
      created_at: now,
      updated_at: now,
    });
    await tx.commit();

    const pack = await memory.packContext('memory.context-pack', { budget: 200 });
    assert.equal(pack.schemaVersion, '1');
    assert.equal(pack.query, 'memory.context-pack');
    assert.equal(pack.records[0]?.id, 'memory.context-pack');
    assert.equal(pack.records[0]?.source?.path, 'decisions/payment-timeout.md');
    assert.match(pack.text, /Retry after timeout/);
    assert.ok(pack.provenance.executed);
  } finally {
    await memory.close();
  }
});

test('Pmem.packContext carries validated semantic provenance into evidence', async () => {
  const root = makeProject();
  const backend = new SqliteMemoryBackend(path.join(root, '.pmem'));
  const memory = await Pmem.open({ root, backend });
  try {
    const now = new Date().toISOString();
    const tx = await backend.beginTransaction();
    await tx.putRecord({
      id: 'memory.semantic-pack',
      schema: { id: 'memory', version: '1.0.0' },
      data: { title: 'Semantic result', content: 'A semantically relevant memory.' },
      scope: 'project',
      provenance: { source: 'runtime-test' },
      created_at: now,
      updated_at: now,
    });
    await tx.commit();
    const semanticEvidence = createSemanticEvidence({
      provenance: { model: 'test-model', revision: 'rev-1', dimension: 3, chunkStrategy: 'heading-aware-v1' },
      chunkId: 'memory.semantic-pack#0',
      heading: 'Semantic result',
      headingPath: ['Semantic result'],
      similarity: 0.91,
      parentRecord: 'memory.semantic-pack',
    });
    backend.setSemanticAdapter({
      search: async () => ({
        hits: [{
          record_id: 'memory.semantic-pack',
          score: semanticEvidence.similarity,
          channels: ['semantic'],
          metadata: { semanticEvidence },
        }],
      }),
    });

    const pack = await memory.packContext('semantic result', { budget: 400 });
    assert.equal(pack.evidence[0]?.id, semanticEvidence.chunkId);
    assert.equal(pack.evidence[0]?.recordId, 'memory.semantic-pack');
    assert.deepEqual(pack.evidence[0]?.provenance, semanticEvidence.provenance);
    assert.deepEqual(pack.evidence[0]?.metadata?.semanticEvidence, semanticEvidence);
  } finally {
    await memory.close();
  }
});

test('Pmem.forget rejects an unknown card or event without writing a tombstone', async () => {
  const root = makeProject();
  const memory = await openV12Pmem({ root });
  const dbPath = path.join(root, '.pmem', 'pmem.db');
  try {
    const countEvents = (): number => {
      const db = new Database(dbPath);
      try {
        return (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count;
      } finally {
        db.close();
      }
    };
    const before = countEvents();
    await assert.rejects(
      memory.forget({ id: 'module.does_not_exist', reason: 'typo' }),
      /Memory not found: module\.does_not_exist/,
    );
    assert.equal(countEvents(), before);
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

  const memory = await openV12Pmem({ root });
  const previous = process.cwd();
  process.chdir(elsewhere);
  try {
    const status = await memory.status();
    assert.equal(status.source, 'git');
    assert.ok(status.changes.some((change: any) => change.path === 'src/index.ts'));

    const capture = await memory.capture('cross cwd runtime capture', { force: true });
    assert.equal(capture.success, true, capture.message);
    assert.ok(capture.tracePath?.startsWith(path.join(root, '.pmem', 'traces')));
    assert.match(fs.readFileSync(capture.tracePath!, 'utf8'), /src\/index\.ts/);

    const recall = await memory.recall({ recent: 1 });
    assert.match(recall.recent_traces?.[0]?.file_path ?? '', /^\.pmem\/traces\//);
    assert.ok(recall.recent_events?.some((event: any) => event.branch === 'runtime-root-x'));

    const context = await memory.context('cross cwd branch event');
    assert.ok(context.changed_files.some((change: any) => change.path === 'src/index.ts'));
    assert.match((context.recent_session_memory ?? []).join('\n'), /runtime-root-x/);
  } finally {
    process.chdir(previous);
    await memory.close();
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('capture commits canonically when automatic semantic indexing is unavailable', async () => {
  const root = makeProject();
  const pmemPath = path.join(root, '.pmem');
  const manifest = getDefaultManifest('runtime-semantic-degraded');
  manifest.embedding = {
    enabled: true,
    auto_enabled: true,
    provider: 'local',
    model: DEFAULT_SEMANTIC_MODEL,
    revision: DEFAULT_SEMANTIC_MODEL_REVISION,
    source: 'modelscope',
    dtype: 'uint8',
    cache_path: path.join(root, 'missing-semantic-cache'),
    dimension: 384,
    store: 'sqlite',
    index: 'flat',
  };
  saveManifest(pmemPath, manifest);
  execSync('git init -q', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  execSync('git config user.name "test"', { cwd: root });
  execSync('git checkout -q -b semantic-degraded', { cwd: root });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFile(path.join(root, 'src', 'semantic.ts'), 'export const semantic = false;\n');

  const memory = await openV12Pmem({ root });
  try {
    const capture = await memory.capture('capture without local semantic asset', { force: true });
    assert.equal(capture.success, true, capture.message);
    assert.equal(capture.semantic?.status, 'unavailable');
    assert.ok(capture.tracePath);
    const db = new Database(path.join(pmemPath, 'pmem.db'));
    try {
      const events = new EventStore(db, '1h').replay();
      assert.ok(events.some(event => event.type === 'commit'));
    } finally {
      db.close();
    }
  } finally {
    await memory.close();
  }
});

test('Pmem.context keeps non-git changed_files unique and non-consuming', async () => {
  const root = makeProject();
  const pmemPath = path.join(root, '.pmem');
  const manifest = getDefaultManifest('runtime-context-mtime');
  manifest.schema = {
    card_types: ['trace'],
    type_dirs: { trace: 'traces' },
    foundational_types: [],
    evidence_types: ['trace'],
    default_type: 'trace',
    creatable_types: ['trace'],
  };
  (manifest as any).change_detection = { mtime_scan_dirs: ['.pmem'] };
  saveManifest(pmemPath, manifest);

  // This test locks non-consuming/deduplicated runtime output. The exact
  // boundary-time race is covered separately by status.test.ts; leave enough
  // filesystem timestamp headroom here to avoid platform precision flakes.
  const boundary = Date.now() - 1000;
  writeFile(path.join(pmemPath, '.last-status'), JSON.stringify({
    version: 1,
    watermark_ms: boundary,
    pending: [],
  }, null, 2));
  const tracePath = path.join(pmemPath, 'traces', 'trace.context-change.md');
  writeFile(tracePath, `---
id: trace.context-change
type: trace
---
# Context change
`);
  fs.utimesSync(tracePath, (boundary + 500) / 1000, (boundary + 500) / 1000);

  const memory = await openV12Pmem({ root });
  try {
    const first = await memory.context('changed files');
    const second = await memory.context('changed files again');
    for (const result of [first, second]) {
      const paths = result.changed_files.map((change: any) => change.path);
      assert.equal(new Set(paths).size, paths.length, JSON.stringify(paths));
      assert.equal(paths.filter((filePath: any) => filePath === '.pmem/traces/trace.context-change.md').length, 1);
    }
  } finally {
    await memory.close();
  }
});


test('two same-root Pmem instances keep independent DB handles after one closes', async () => {
  const root = makeProject();
  const first = await openV12Pmem({ root });
  const second = await openV12Pmem({ root });
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

  const memory = await openV12Pmem({ root });
  try {
    const ask = await memory.ask('Cache Guard');
    assert.equal(ask.matched[0]?.id, row.id);
    assert.match(ask.warnings?.[0] ?? '', /cache is missing/i);
    const context = await memory.context('Cache Guard');
    assert.ok(context.relevant_memory.some((card: any) => card.id === row.id));
    assert.ok(context.warnings.some((warning: any) => /cache is missing/i.test(warning)));
  } finally {
    await memory.close();
  }
});
