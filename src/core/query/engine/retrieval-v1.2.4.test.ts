import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { CardRow, EdgeRow } from '../../../types';
import { createFTS5, createSchema, insertEdge, refreshCardFts, upsertCard } from '../../db';
import { generateCandidates } from './candidates';
import { parseIntent } from './intent';
import { buildQueryPlan } from './queryPlan';
import { getRerankProfile, rerankCandidates, type RerankProfile } from './rerank';
import { fuseAndScore, type ScoredResult } from './scoring';
import fixture from './fixtures/retrieval-v1.2.4-small-project.json';

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
  query: string;
  relevant_ids: string[];
  semantic_scores: Record<string, number>;
}

const cards = fixture.cards as FixtureCard[];
const queries = fixture.queries as FixtureQuery[];
const NOW = Date.parse('2026-08-02T00:00:00.000Z');
const KNOWN_TYPES = ['character', 'chapter', 'system', 'world'];

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  createSchema(db);
  createFTS5(db);
  for (const [index, value] of cards.entries()) {
    const row: CardRow = {
      id: value.id,
      type: value.type,
      title: value.title,
      status: 'active',
      priority: null,
      file_path: value.source_path,
      summary: value.summary,
      schema_version: '0.3',
      card_version: 1,
      created_at: '2026-08-02T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
      last_verified_at: '2026-08-02T00:00:00.000Z',
      file_hash: `file-${index}`,
      frontmatter_hash: `frontmatter-${index}`,
      body_hash: `body-${index}`,
      token_count: 20,
      section_count: 1,
      is_deleted: 0,
      is_candidate: 0,
      trust_label: 'user_confirmed',
      sensitivity: 'internal',
    };
    upsertCard(db, row);
    refreshCardFts(db, {
      id: value.id,
      title: value.title,
      summary: value.summary,
      body: value.body,
      aliases: value.aliases,
      tags: value.tags,
    });
  }
  for (const edge of fixture.edges) insertEdge(db, edge as EdgeRow);
  return db;
}

function semanticCandidates(db: Database.Database, query: FixtureQuery) {
  return cards.map(value => ({
    card: db.prepare('SELECT * FROM cards WHERE id = ?').get(value.id) as CardRow,
    base: query.semantic_scores[value.id],
    graph_distance: 0,
    reasons: [{
      channel: 'semantic' as const,
      detail: `fixture cosine ${query.semantic_scores[value.id].toFixed(2)}`,
      base: query.semantic_scores[value.id],
      similarity: query.semantic_scores[value.id],
    }],
    rerank_text: `${value.title}\n${value.summary}\n${value.body}`,
  }));
}

function rank(db: Database.Database, query: FixtureQuery): { base: ScoredResult[]; reranked: ScoredResult[]; profile: RerankProfile } {
  const intent = parseIntent(query.query, KNOWN_TYPES);
  const candidates = generateCandidates(db, intent, { additionalCandidates: semanticCandidates(db, query) });
  const base = fuseAndScore(candidates, { now: NOW, dirtyCardIds: new Set() });
  const plan = buildQueryPlan(intent);
  const profile = getRerankProfile(base, plan);
  return { base, reranked: rerankCandidates(base, plan), profile };
}

function ids(results: readonly ScoredResult[]): string[] {
  return results.map(result => result.card.id);
}

function topOverlap(left: readonly string[], right: readonly string[], limit = 3): number {
  const a = new Set(left.slice(0, limit));
  const b = new Set(right.slice(0, limit));
  const intersection = [...a].filter(id => b.has(id)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

describe('v1.2.4 small-project retrieval evaluation', () => {
  it('keeps the fixture deterministic and covers both issue shapes', () => {
    assert.equal(fixture.fixture_version, 'v1.2.4-small-project-2026-08-02.1');
    assert.equal(new Set(queries.map(query => query.id)).size, queries.length);
    assert.ok(queries.some(query => query.id === 'fact-defeat-karl'));
    assert.ok(queries.filter(query => query.id.startsWith('creative-')).length >= 3);
  });

  it('reduces top-3 overlap between distinct creative queries with a flat semantic head', () => {
    const db = makeDb();
    try {
      const creative = queries.filter(query => query.id.startsWith('creative-'));
      const ranked = creative.map(query => ({ query, result: rank(db, query) }));
      assert.ok(ranked.every(item => item.result.profile.mode === 'compact_deterministic'));
      assert.ok(ranked.every(item => item.result.profile.semantic_flat));
      assert.ok(ranked.every(item => item.result.profile.weights.semantic < 0.1));

      const overlaps: number[] = [];
      for (let left = 0; left < ranked.length; left++) {
        for (let right = left + 1; right < ranked.length; right++) {
          overlaps.push(topOverlap(ids(ranked[left].result.reranked), ids(ranked[right].result.reranked)));
        }
      }
      const meanOverlap = overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length;
      assert.ok(meanOverlap < 0.5, `creative top-3 overlap remained ${meanOverlap.toFixed(3)}`);
      assert.ok(ranked.every(item => item.result.reranked.slice(0, 3).some(result => item.query.relevant_ids.includes(result.card.id))));
      if (process.env.PMEM_PRINT_RETRIEVAL_EVAL === '1') {
        process.stdout.write(`${JSON.stringify({ mean_top3_overlap: meanOverlap, creative: ranked.map(item => ({ id: item.query.id, base: ids(item.result.base).slice(0, 5), reranked: ids(item.result.reranked).slice(0, 5), profile: item.result.profile })) }, null, 2)}\n`);
      }
    } finally {
      db.close();
    }
  });

  it('answers a Chinese factual relation query through an existing graph edge', () => {
    const db = makeDb();
    try {
      const query = queries.find(value => value.id === 'fact-defeat-karl')!;
      const result = rank(db, query);
      const event = result.reranked.find(value => value.card.id === 'chapter.ch03_training')!;
      assert.equal(result.profile.mode, 'factual_graph');
      assert.equal(result.reranked[0].card.id, 'chapter.ch03_training');
      assert.ok(result.reranked.slice(0, 3).some(value => value.card.id === 'chapter.ch03_training'));
      assert.equal(event.graph_evidence?.seed_card_id, 'character.karl');
      assert.equal(event.graph_evidence?.edge_type, 'references');
      assert.equal(event.graph_evidence?.seed_evidence, 'lexical');
      assert.notEqual(event.graph_evidence?.edge_type, 'defeated_by', 'the engine must not invent a relation type');
      assert.ok(event.reasons.some(reason => reason.channel === 'graph') || event.graph_evidence, 'actual graph evidence must be retained internally');
    } finally {
      db.close();
    }
  });
});
