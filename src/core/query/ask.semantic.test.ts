import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { askQuery, askQueryWithSemantic } from './ask';
import { closeDatabase, createSchema, insertEdge, insertPath, openOwnedDatabase, upsertCard } from '../db';
import { rebuildSemanticIndex, type EmbeddingProvider } from '../semantic';
import type { CardRow } from '../../types';
import type Database from 'better-sqlite3';
import { getDefaultManifest, saveManifest } from '../manifest';

const roots: string[] = [];
const databases: Database.Database[] = [];

function card(id: string, title: string): CardRow {
  return {
    id,
    type: id.startsWith('module.') ? 'module' : 'decision',
    title,
    status: 'active',
    priority: null,
    file_path: `.pmem/cards/${id}.md`,
    summary: null,
    schema_version: null,
    card_version: 1,
    created_at: null,
    updated_at: '2026-07-24T00:00:00.000Z',
    last_verified_at: '2026-07-24T00:00:00.000Z',
    file_hash: `${id}-file`,
    frontmatter_hash: `${id}-frontmatter`,
    body_hash: `${id}-body`,
    token_count: 20,
    section_count: 1,
    is_deleted: 0,
    is_candidate: 0,
    trust_label: 'user_confirmed',
    sensitivity: 'internal',
  };
}

function provider(): EmbeddingProvider {
  const vectorFor = (value: string): readonly number[] => value.includes('authentication') || value.includes('登录')
    ? [1, 0]
    : [0, 1];
  return {
    modelId: 'test/e5',
    revision: 'fixed',
    dimension: 2,
    async embedPassages(texts) { return texts.map(vectorFor); },
    async embedQuery(text) { return vectorFor(text); },
  };
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-semantic-ask-'));
  roots.push(root);
  const pmemPath = path.join(root, '.pmem');
  fs.mkdirSync(pmemPath, { recursive: true });
  const manifest = getDefaultManifest('semantic-ask-test');
  manifest.embedding = {
    enabled: true, provider: 'local', model: 'test/e5', revision: 'fixed',
    dtype: 'uint8', dimension: 2, store: 'sqlite', index: 'flat',
  };
  saveManifest(pmemPath, manifest);
  const db = openOwnedDatabase(pmemPath);
  databases.push(db);
  createSchema(db);
  const auth = card('decision.auth', 'Credential Boundary');
  const neighbor = card('module.session', 'Session Runtime');
  const pathCard = card('module.path', 'Path Owner');
  for (const value of [auth, neighbor, pathCard]) upsertCard(db, value);
  for (const value of [auth, neighbor, pathCard]) {
    const absolute = path.join(root, value.file_path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `---\nid: ${value.id}\ntype: ${value.type}\nstatus: active\ntrust_label: user_confirmed\nsensitivity: internal\n---\n# ${value.title}\n`);
  }
  insertPath(db, pathCard.id, 'src/auth/login.ts', 'source_file');
  insertEdge(db, {
    from_id: auth.id,
    to_id: neighbor.id,
    type: 'depends_on',
    source: 'explicit',
    confidence: 1,
  });
  await rebuildSemanticIndex(db, [
    {
      id: auth.id,
      title: auth.title,
      body: '# Authentication\n\nHandles authentication, passwords, and 登录 credentials.',
      frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
    },
    {
      id: neighbor.id,
      title: neighbor.title,
      body: '# Sessions\n\nTracks session lifecycle.',
      frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
    },
    {
      id: pathCard.id,
      title: pathCard.title,
      body: '# Files\n\nOwns filesystem mappings.',
      frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
    },
  ], provider(), { mode: 'full' });
  return { db, pmemPath };
}

afterEach(() => {
  closeDatabase();
  while (databases.length > 0) closeDatabase(databases.pop());
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('v1.1.1 semantic ask fusion', () => {
  it('adds parent-card semantic provenance before graph expansion', async () => {
    const { db, pmemPath } = await fixture();
    const result = await askQueryWithSemantic(pmemPath, '登录凭据放在哪里', provider(), {
      db,
      explain: true,
      limit: 5,
      now: Date.parse('2026-07-24T00:00:00.000Z'),
    });
    const auth = result.matched.find(match => match.id === 'decision.auth');
    assert.ok(auth, 'semantic parent card should be returned');
    const reason = auth.reasons?.find(item => item.channel === 'semantic');
    assert.ok(reason?.chunk_id);
    assert.strictEqual(reason?.parent_card, 'decision.auth');
    assert.strictEqual(reason?.model_revision, 'fixed');
    assert.strictEqual(auth.rerank?.version, 'contextual-v1');
    const expanded = result.matched.find(match => match.id === 'module.session');
    assert.strictEqual(expanded?.match_type, 'graph_expansion');
    assert.strictEqual(expanded?.from_card, 'decision.auth');
    assert.strictEqual(expanded?.edge_type, 'depends_on');
    assert.ok(expanded?.reasons?.some(item => item.channel === 'graph'));
    assert.strictEqual(result.diagnostics?.semantic.accepted_card_hits, 1);
  });

  it('returns actionable aggregate diagnostics when every card lacks explicit trust', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-semantic-untrusted-'));
    roots.push(root);
    const pmemPath = path.join(root, '.pmem');
    fs.mkdirSync(path.join(pmemPath, 'cards'), { recursive: true });
    const manifest = getDefaultManifest('semantic-untrusted-test');
    manifest.embedding = { enabled: true, provider: 'local', model: 'test/e5', revision: 'fixed', dtype: 'uint8', dimension: 2, store: 'sqlite', index: 'flat' };
    saveManifest(pmemPath, manifest);
    const db = openOwnedDatabase(pmemPath);
    databases.push(db);
    createSchema(db);
    const value = card('decision.private', 'Private Boundary');
    value.trust_label = null;
    upsertCard(db, value);
    fs.writeFileSync(path.join(pmemPath, 'cards', 'decision.private.md'), '---\nid: decision.private\ntype: decision\nstatus: active\nsensitivity: internal\n---\n# Private Boundary\n\npassword=never-print-this\n');
    await rebuildSemanticIndex(db, [{
      id: value.id, title: value.title, body: 'password=never-print-this',
      frontmatter: { sensitivity: 'internal' },
    }], provider(), { mode: 'full' });

    const result = await askQueryWithSemantic(pmemPath, 'unrelated astronomy query', provider(), { db });
    assert.deepStrictEqual(result.matched, []);
    assert.strictEqual(result.diagnostics?.no_result_reason, 'semantic_all_cards_excluded');
    assert.deepStrictEqual(result.diagnostics?.semantic.excluded_by_trust_detail, { missing_trust_label: 1 });
    assert.strictEqual(JSON.stringify(result.diagnostics).includes('never-print-this'), false);
  });

  it('keeps an exact source path ahead of a semantic-only candidate', async () => {
    const { db, pmemPath } = await fixture();
    const result = await askQueryWithSemantic(pmemPath, 'src/auth/login.ts', provider(), {
      db,
      explain: true,
      limit: 5,
      now: Date.parse('2026-07-24T00:00:00.000Z'),
    });
    assert.strictEqual(result.matched[0].id, 'module.path');
    assert.strictEqual(result.matched[0].match_type, 'source_file');
  });

  it('degrades deterministically with an actionable warning when the index is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-semantic-empty-'));
    roots.push(root);
    const pmemPath = path.join(root, '.pmem');
    fs.mkdirSync(pmemPath, { recursive: true });
    const db = openOwnedDatabase(pmemPath);
    databases.push(db);
    createSchema(db);
    upsertCard(db, card('decision.fallback', 'Fallback Decision'));
    const result = await askQueryWithSemantic(pmemPath, 'fallback', provider(), { db });
    assert.strictEqual(result.matched[0].id, 'decision.fallback');
    assert.match(result.warnings?.[0] ?? '', /semantic rebuild/i);
  });

  it('degrades to the unchanged deterministic order when a v1 index is present', async () => {
    const { db, pmemPath } = await fixture();
    const deterministic = askQuery(pmemPath, 'Credential Boundary', {
      db,
      explain: true,
      limit: 5,
      now: Date.parse('2026-07-24T00:00:00.000Z'),
    });
    db.prepare('UPDATE semantic_meta SET pipeline_version = 1').run();
    const degraded = await askQueryWithSemantic(pmemPath, 'Credential Boundary', provider(), {
      db,
      explain: true,
      limit: 5,
      now: Date.parse('2026-07-24T00:00:00.000Z'),
    });
    assert.deepStrictEqual(degraded.matched, deterministic.matched);
    assert.match(degraded.warnings?.[0] ?? '', /pipeline v1.*v2.*semantic rebuild/i);
  });
});
