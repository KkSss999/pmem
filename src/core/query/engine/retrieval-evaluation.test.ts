import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { createFTS5, createSchema, insertAlias, insertPath, insertTag, refreshCardFts, upsertCard } from '../../db';
import type { CardRow } from '../../../types';
import { parseIntent } from './intent';
import { generateCandidates } from './candidates';
import { fuseAndScore } from './scoring';
import fixture from './fixtures/retrieval-v1.1.1.json';
import baseline from './fixtures/retrieval-v1.1.1-baseline.json';
import hardNegatives from './fixtures/retrieval-v1.2.0-hard-negatives.json';

type Slice = 'zh' | 'en' | 'code_path_mixed';

interface FixtureCard {
  id: string;
  type: string;
  title: string;
  summary: string;
  body: string;
  aliases: string[];
  tags: string[];
  source_path: string;
}

interface FixtureQuery {
  id: string;
  slice: Slice;
  query: string;
  relevant_ids: string[];
}

interface SliceMetrics {
  query_count: number;
  recall_at_5: number;
  mrr: number;
}

interface EvaluationReport {
  fixture_version: string;
  evaluator: 'deterministic-v0.8';
  query_count: number;
  recall_at_5: number;
  mrr: number;
  slices: Record<Slice, SliceMetrics>;
  exact_query_success: {
    query_count: number;
    success_count: number;
    success_rate: number;
    by_kind: Record<'id' | 'title' | 'path', { query_count: number; success_count: number; success_rate: number }>;
  };
  latency_ms: {
    sample_count: number;
    mean: number;
    p50: number;
    p95: number;
  };
}

const NOW = Date.parse('2026-07-24T00:00:00.000Z');
const KNOWN_TYPES = ['decision', 'feature', 'module', 'risk'];

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(p * sorted.length) - 1] ?? 0;
}

function makeDb(cards: FixtureCard[]): Database.Database {
  const db = new Database(':memory:');
  createSchema(db);
  createFTS5(db);
  for (const [index, card] of cards.entries()) {
    const row: CardRow = {
      id: card.id,
      type: card.type,
      title: card.title,
      status: 'active',
      priority: null,
      file_path: `.pmem/${card.type}s/${card.id}.md`,
      summary: card.summary,
      schema_version: '0.3',
      card_version: 1,
      created_at: '2026-07-24T00:00:00.000Z',
      updated_at: '2026-07-24T00:00:00.000Z',
      last_verified_at: '2026-07-24T00:00:00.000Z',
      file_hash: `file-${index}`,
      frontmatter_hash: `frontmatter-${index}`,
      body_hash: `body-${index}`,
      token_count: 20,
      section_count: 1,
      is_deleted: 0,
      is_candidate: 0,
      confidence: null,
      superseded_by: null,
      classification: null,
      trust_label: 'user_confirmed',
      sensitivity: 'internal',
    };
    upsertCard(db, row);
    for (const alias of card.aliases) insertAlias(db, card.id, alias);
    for (const tag of card.tags) insertTag(db, card.id, tag);
    insertPath(db, card.id, card.source_path, 'source');
    refreshCardFts(db, {
      id: card.id,
      title: card.title,
      summary: card.summary,
      body: card.body,
      aliases: card.aliases,
      tags: card.tags,
    });
  }
  return db;
}

function rankedIds(db: Database.Database, query: string): string[] {
  const intent = parseIntent(query, KNOWN_TYPES);
  const candidates = generateCandidates(db, intent);
  return fuseAndScore(candidates, { now: NOW, dirtyCardIds: new Set() }).map(result => result.card.id);
}

function rankOfAny(ids: string[], relevantIds: string[]): number {
  const relevant = new Set(relevantIds);
  const index = ids.findIndex(id => relevant.has(id));
  return index < 0 ? 0 : index + 1;
}

function queryMetrics(db: Database.Database, queries: FixtureQuery[]): SliceMetrics {
  let hits = 0;
  let reciprocalRank = 0;
  for (const query of queries) {
    const rank = rankOfAny(rankedIds(db, query.query), query.relevant_ids);
    if (rank > 0 && rank <= 5) hits += 1;
    if (rank > 0) reciprocalRank += 1 / rank;
  }
  return {
    query_count: queries.length,
    recall_at_5: round(hits / queries.length),
    mrr: round(reciprocalRank / queries.length),
  };
}

function exactMetrics(db: Database.Database, cards: FixtureCard[]): EvaluationReport['exact_query_success'] {
  const byKind = {
    id: { query_count: cards.length, success_count: 0, success_rate: 0 },
    title: { query_count: cards.length, success_count: 0, success_rate: 0 },
    path: { query_count: cards.length, success_count: 0, success_rate: 0 },
  };
  for (const card of cards) {
    if (rankedIds(db, card.id)[0] === card.id) byKind.id.success_count += 1;
    if (rankedIds(db, card.title)[0] === card.id) byKind.title.success_count += 1;
    if (rankedIds(db, card.source_path)[0] === card.id) byKind.path.success_count += 1;
  }
  for (const value of Object.values(byKind)) value.success_rate = round(value.success_count / value.query_count);
  const queryCount = cards.length * 3;
  const successCount = Object.values(byKind).reduce((sum, value) => sum + value.success_count, 0);
  return { query_count: queryCount, success_count: successCount, success_rate: round(successCount / queryCount), by_kind: byKind };
}

function evaluate(): EvaluationReport {
  const cards = fixture.cards as FixtureCard[];
  const queries = fixture.queries as FixtureQuery[];
  const db = makeDb(cards);
  try {
    const timings: number[] = [];
    for (const query of queries) {
      const started = performance.now();
      rankedIds(db, query.query);
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    const slices = {
      zh: queryMetrics(db, queries.filter(query => query.slice === 'zh')),
      en: queryMetrics(db, queries.filter(query => query.slice === 'en')),
      code_path_mixed: queryMetrics(db, queries.filter(query => query.slice === 'code_path_mixed')),
    };
    const overall = queryMetrics(db, queries);
    return {
      fixture_version: fixture.fixture_version,
      evaluator: 'deterministic-v0.8',
      query_count: queries.length,
      recall_at_5: overall.recall_at_5,
      mrr: overall.mrr,
      slices,
      exact_query_success: exactMetrics(db, cards),
      latency_ms: {
        sample_count: timings.length,
        mean: round(timings.reduce((sum, value) => sum + value, 0) / timings.length, 3),
        p50: round(percentile(timings, 0.5), 3),
        p95: round(percentile(timings, 0.95), 3),
      },
    };
  } finally {
    db.close();
  }
}

describe('v1.1.1 locked retrieval evaluation', () => {
  it('locks at least 30 v1.2 hard negatives with explicit distractors', () => {
    assert.ok(hardNegatives.queries.length >= 30);
    assert.equal(new Set(hardNegatives.queries.map(query => query.id)).size, hardNegatives.queries.length);
    for (const query of hardNegatives.queries) {
      assert.ok(query.relevant_ids.length > 0);
      assert.ok(query.distractor_ids.length > 0);
      assert.ok(query.distractor_ids.every(id => !query.relevant_ids.includes(id)));
    }
  });
  it('keeps the corpus versioned and evenly split across all required slices', () => {
    assert.equal(fixture.queries.length, 60);
    assert.equal(new Set(fixture.queries.map(query => query.id)).size, 60);
    assert.deepEqual(
      Object.fromEntries(['zh', 'en', 'code_path_mixed'].map(slice => [slice, fixture.queries.filter(query => query.slice === slice).length])),
      { zh: 20, en: 20, code_path_mixed: 20 },
    );
    assert.equal(fixture.fixture_version, baseline.fixture_version);
  });

  it('matches the locked deterministic quality baseline and preserves every exact query', () => {
    const report = evaluate();
    if (process.env.PMEM_PRINT_RETRIEVAL_EVAL === '1') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    assert.equal(report.query_count, 60);
    assert.equal(report.recall_at_5, baseline.recall_at_5);
    assert.equal(report.mrr, baseline.mrr);
    assert.deepEqual(report.slices, baseline.slices);
    assert.deepEqual(report.exact_query_success, baseline.exact_query_success);
    assert.equal(report.exact_query_success.success_rate, 1);
    assert.equal(report.latency_ms.sample_count, 60);
    assert.ok(report.latency_ms.p50 >= 0);
    assert.ok(report.latency_ms.p95 >= report.latency_ms.p50);
  });
});
