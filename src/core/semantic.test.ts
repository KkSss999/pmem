import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { createSchema, upsertCard } from './db';
import {
  chunkCard,
  clearSemanticIndex,
  cosineSimilarity,
  createSemanticSchema,
  decodeVector,
  deleteSemanticCardChunks,
  encodeVector,
  getSemanticStatus,
  isSemanticSafeCard,
  rebuildSemanticIndex,
  searchSemanticCards,
  SEMANTIC_PIPELINE_VERSION,
  type EmbeddingProvider,
  type SemanticCardDocument,
} from './semantic';
import type { CardRow } from '../types';

function dbWithCards(ids: string[]): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  for (const id of ids) {
    const row: CardRow = {
      id,
      type: 'decision',
      title: id,
      status: 'active',
      priority: null,
      file_path: `.pmem/decisions/${id}.md`,
      summary: null,
      schema_version: null,
      card_version: 1,
      created_at: null,
      updated_at: null,
      last_verified_at: null,
      file_hash: id,
      frontmatter_hash: id,
      body_hash: id,
      token_count: 1,
      section_count: 1,
      is_deleted: 0,
      is_candidate: 0,
      trust_label: 'system_trusted',
      sensitivity: 'internal',
    };
    upsertCard(db, row);
  }
  return db;
}

function document(id: string, body: string, overrides: Partial<SemanticCardDocument> = {}): SemanticCardDocument {
  return {
    id,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    body,
    frontmatter: { trust_label: 'system_trusted', sensitivity: 'internal' },
    ...overrides,
  };
}

class SpyProvider implements EmbeddingProvider {
  readonly modelId = 'test/e5';
  readonly revision = 'pinned-revision';
  readonly dimension = 3;
  passages: string[] = [];
  queries: string[] = [];
  fail = false;

  async embedPassages(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.passages.push(...texts);
    if (this.fail) throw new Error('provider failed');
    return texts.map(text => {
      const chinese = /[\u3400-\u9fff]/.test(text) ? 1 : 0;
      return [text.length + 1, chinese + 1, 1];
    });
  }

  async embedQuery(text: string): Promise<readonly number[]> {
    this.queries.push(text);
    return [text.length + 1, /[\u3400-\u9fff]/.test(text) ? 2 : 1, 1];
  }
}

describe('semantic chunking and vectors', () => {
  it('creates stable heading-aware chunks and ignores headings inside code fences', () => {
    const card = document('decision.chunk', [
      '# Top',
      'intro',
      '## Child',
      'body',
      '```md',
      '# not a heading',
      '```',
    ].join('\n'));
    const first = chunkCard(card);
    const second = chunkCard(card);
    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first.map(chunk => chunk.headingPath), [['Top'], ['Top', 'Child']]);
    assert.match(first[1].content, /# not a heading/);
    assert.ok(first.every(chunk => chunk.estimatedTokens <= 480));
  });

  it('adds stable card context to passages without adding freshness timestamps', () => {
    const [chunk] = chunkCard(document('decision.context', '# Boundary\nbody', {
      type: 'decision',
      status: 'active',
      aliases: ['auth boundary'],
      tags: ['security'],
      sourceFiles: ['src/auth.ts'],
      relatedCardIds: ['module.session'],
    }));
    assert.match(chunk.context, /Context: decision \| auth boundary \| security \| auth\.ts \| module\.session/);
    assert.doesNotMatch(chunk.context, /updated|last_verified/i);
  });

  it('splits oversized multilingual/code sections deterministically below the 512-token ceiling', () => {
    const body = `## 大型实现\n${'const value = "语义"; '.repeat(120)}`;
    const chunks = chunkCard(document('feature.large', body), { maxTokens: 512, reservedTokens: 32 });
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.estimatedTokens <= 480));
    assert.deepStrictEqual(chunks.map(chunk => chunk.chunkId), chunkCard(document('feature.large', body)).map(chunk => chunk.chunkId));
  });

  it('normalizes Float32 vectors into portable SQLite BLOBs', () => {
    const blob = encodeVector([3, 4], 2);
    assert.strictEqual(blob.byteLength, 8);
    const decoded = decodeVector(blob, 2);
    assert.ok(Math.abs(decoded[0] - 0.6) < 1e-6);
    assert.ok(Math.abs(decoded[1] - 0.8) < 1e-6);
    assert.ok(Math.abs(cosineSimilarity(decoded, decoded) - 1) < 1e-6);
  });
});

describe('semantic safety and SQLite lifecycle', () => {
  it('creates the two derived semantic tables idempotently', () => {
    const db = dbWithCards([]);
    try {
      createSemanticSchema(db);
      createSemanticSchema(db);
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'semantic_%' ORDER BY name").all() as Array<{ name: string }>;
      assert.deepStrictEqual(names.map(row => row.name), ['semantic_chunks', 'semantic_meta']);
    } finally {
      db.close();
    }
  });

  it('excludes every unsafe class before the embedding provider is invoked', async () => {
    const ids = ['safe', 'secret', 'untrusted', 'imported', 'agent', 'tool', 'missing', 'candidate', 'deleted', 'superseded'];
    const db = dbWithCards(ids);
    const provider = new SpyProvider();
    const docs = [
      document('safe', 'SAFE ONLY', { relatedCardIds: ['secret'] }),
      document('secret', 'SECRET NEVER', { aliases: ['SECRET ALIAS NEVER'], sourceFiles: ['secret/path.ts'], frontmatter: { trust_label: 'system_trusted', sensitivity: 'secret' } }),
      document('untrusted', 'UNTRUSTED NEVER', { frontmatter: { trust_label: 'untrusted_content' } }),
      document('imported', 'IMPORTED NEVER', { frontmatter: { trust_label: 'imported_external' } }),
      document('agent', 'AGENT NEVER', { frontmatter: { trust_label: 'agent_generated' } }),
      document('tool', 'TOOL NEVER', { frontmatter: { trust_label: 'tool_observed' } }),
      document('missing', 'MISSING NEVER', { frontmatter: {} }),
      document('candidate', 'CANDIDATE NEVER', { isCandidate: true }),
      document('deleted', 'DELETED NEVER', { isDeleted: true }),
      document('superseded', 'SUPERSEDED NEVER', { frontmatter: { trust_label: 'user_confirmed', superseded_by: ['new'] } }),
    ];
    try {
      const result = await rebuildSemanticIndex(db, docs, provider, { mode: 'full' });
      assert.strictEqual(result.cardsExcluded, 9);
      assert.ok(provider.passages.length > 0);
      assert.ok(provider.passages.every(text => text.includes('SAFE ONLY')));
      assert.ok(provider.passages.every(text => !text.includes('SECRET ALIAS NEVER') && !text.includes('secret/path.ts')));
      assert.ok(provider.passages.every(text => !text.includes('secret')));
      const contexts = db.prepare('SELECT context FROM semantic_chunks').all() as Array<{ context: string }>;
      assert.ok(contexts.every(row => !row.context.includes('secret')));
      const rows = db.prepare('SELECT DISTINCT card_id FROM semantic_chunks').all() as Array<{ card_id: string }>;
      assert.deepStrictEqual(rows.map(row => row.card_id), ['safe']);
      assert.ok(isSemanticSafeCard(docs[0]));
      assert.ok(!isSemanticSafeCard(docs[4]));
    } finally {
      db.close();
    }
  });

  it('records a compatible healthy empty index when every card is excluded', async () => {
    const db = dbWithCards(['secret']);
    const provider = new SpyProvider();
    try {
      const result = await rebuildSemanticIndex(db, [
        document('secret', 'SECRET NEVER', { frontmatter: { trust_label: 'system_trusted', sensitivity: 'secret' } }),
      ], provider, { mode: 'full' });
      assert.equal(result.chunksTotal, 0);
      assert.equal(provider.passages.length, 0);
      assert.deepEqual(getSemanticStatus(db), {
        available: true,
        pipelineVersion: SEMANTIC_PIPELINE_VERSION,
        compatible: true,
        modelId: provider.modelId,
        revision: provider.revision,
        dimension: provider.dimension,
        cardCount: 0,
        chunkCount: 0,
        indexContentHash: result.indexContentHash,
        builtAt: getSemanticStatus(db).builtAt,
      });
    } finally {
      db.close();
    }
  });

  it('marks a v1 semantic index incompatible until it is rebuilt as pipeline v2', async () => {
    const db = dbWithCards(['one']);
    const provider = new SpyProvider();
    try {
      await rebuildSemanticIndex(db, [document('one', 'trusted')], provider, { mode: 'full' });
      assert.equal(getSemanticStatus(db).pipelineVersion, SEMANTIC_PIPELINE_VERSION);
      db.prepare('UPDATE semantic_meta SET pipeline_version = 1').run();
      const legacy = getSemanticStatus(db);
      assert.equal(legacy.available, false);
      assert.equal(legacy.compatible, false);
      assert.equal(legacy.pipelineVersion, 1);
      const rebuilt = await rebuildSemanticIndex(db, [document('one', 'trusted')], provider, { mode: 'incremental' });
      assert.equal(rebuilt.chunksEmbedded, 1, 'old pipeline vectors must not be reused');
      assert.equal(getSemanticStatus(db).pipelineVersion, SEMANTIC_PIPELINE_VERSION);
      assert.equal(getSemanticStatus(db).available, true);
    } finally {
      db.close();
    }
  });

  it('updates contextual metadata without re-embedding unchanged passage text', async () => {
    const db = dbWithCards(['one']);
    const provider = new SpyProvider();
    try {
      await rebuildSemanticIndex(db, [document('one', 'trusted body', { aliases: ['old alias'] })], provider, { mode: 'full' });
      const before = getSemanticStatus(db).indexContentHash;
      provider.passages = [];
      const result = await rebuildSemanticIndex(db, [document('one', 'trusted body', { aliases: ['new alias'] })], provider, { mode: 'incremental' });
      assert.equal(result.chunksEmbedded, 0);
      assert.deepEqual(provider.passages, []);
      const stored = db.prepare('SELECT context FROM semantic_chunks').get() as { context: string };
      assert.match(stored.context, /new alias/);
      assert.notEqual(getSemanticStatus(db).indexContentHash, before);
    } finally {
      db.close();
    }
  });

  it('supports full, incremental reuse/change/removal, parent collapse, delete, and clear', async () => {
    const db = dbWithCards(['one', 'two']);
    const provider = new SpyProvider();
    try {
      const initialDocs = [document('one', '## A\nalpha\n## B\nbeta'), document('two', '## C\ngamma')];
      const full = await rebuildSemanticIndex(db, initialDocs, provider, { mode: 'full' });
      assert.strictEqual(full.chunksEmbedded, 3);
      assert.strictEqual(getSemanticStatus(db).available, true);

      provider.passages = [];
      const unchanged = await rebuildSemanticIndex(db, initialDocs, provider, { mode: 'incremental' });
      assert.strictEqual(unchanged.chunksEmbedded, 0);
      assert.strictEqual(unchanged.chunksReused, 3);
      assert.deepStrictEqual(provider.passages, []);

      const changed = await rebuildSemanticIndex(db, [document('one', '## A\nalpha changed')], provider, { mode: 'incremental' });
      assert.strictEqual(changed.cardsSeen, 1);
      assert.strictEqual(changed.chunksEmbedded, 1);
      assert.ok(changed.chunksDeleted >= 3);
      const storedCards = db.prepare('SELECT DISTINCT card_id FROM semantic_chunks').all() as Array<{ card_id: string }>;
      assert.deepStrictEqual(storedCards.map(row => row.card_id), ['one']);

      const matches = await searchSemanticCards(db, 'alpha', provider, 5);
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].cardId, 'one');
      assert.strictEqual(matches[0].modelRevision, provider.revision);
      assert.deepStrictEqual(provider.queries, ['alpha']);

      assert.strictEqual(deleteSemanticCardChunks(db, 'one'), 1);
      assert.strictEqual(getSemanticStatus(db).available, true);
      assert.strictEqual(getSemanticStatus(db).chunkCount, 0);
      await rebuildSemanticIndex(db, initialDocs, provider, { mode: 'full' });
      assert.strictEqual(clearSemanticIndex(db), 3);
      assert.strictEqual(getSemanticStatus(db).available, false);
    } finally {
      db.close();
    }
  });

  it('preserves the old index if provider work fails', async () => {
    const db = dbWithCards(['one']);
    const provider = new SpyProvider();
    try {
      await rebuildSemanticIndex(db, [document('one', 'old text')], provider, { mode: 'full' });
      const before = getSemanticStatus(db);
      provider.fail = true;
      await assert.rejects(
        rebuildSemanticIndex(db, [document('one', 'new text')], provider, { mode: 'full' }),
        /provider failed/,
      );
      assert.deepStrictEqual(getSemanticStatus(db), before);
      const content = db.prepare('SELECT content FROM semantic_chunks').get() as { content: string };
      assert.match(content.content, /old text/);
    } finally {
      db.close();
    }
  });

  it('preserves the old index when source revalidation fails before commit', async () => {
    const db = dbWithCards(['one']);
    const provider = new SpyProvider();
    try {
      await rebuildSemanticIndex(db, [document('one', 'old trusted text')], provider, { mode: 'full' });
      const before = getSemanticStatus(db);
      await assert.rejects(
        rebuildSemanticIndex(db, [document('one', 'stale trusted text')], provider, {
          mode: 'full',
          beforeCommit: () => { throw new Error('source changed to secret'); },
        }),
        /source changed to secret/,
      );
      assert.deepStrictEqual(getSemanticStatus(db), before);
      const content = db.prepare('SELECT content FROM semantic_chunks').get() as { content: string };
      assert.match(content.content, /old trusted text/);
    } finally {
      db.close();
    }
  });
});
