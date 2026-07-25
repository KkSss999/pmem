import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import {
  createFTS5,
  createSchema,
  insertAlias,
  insertPath,
  insertTag,
  refreshCardFts,
  upsertCard,
} from '../../db';
import {
  createOfflineTransformersProvider,
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
  rebuildSemanticIndex,
  searchSemanticCardsDetailed,
} from '../../semantic';
import { askQueryWithSemantic } from '../ask';
import type { CardRow } from '../../../types';
import fixture from './fixtures/retrieval-v1.1.1.json';
import baseline from './fixtures/retrieval-v1.1.1-baseline.json';
import semanticBaseline from './fixtures/retrieval-v1.1.1-semantic.json';
import hardNegatives from './fixtures/retrieval-v1.2.0-hard-negatives.json';
import oodFixture from './fixtures/retrieval-v1.2.1-ood.json';

type Slice = 'zh' | 'en' | 'code_path_mixed';
type FixtureCard = (typeof fixture.cards)[number];
type FixtureQuery = (typeof fixture.queries)[number];

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: number[], value: number): number {
  return sorted[Math.ceil(sorted.length * value) - 1] ?? 0;
}

function createFixtureDb(): Database.Database {
  const db = new Database(':memory:');
  createSchema(db);
  createFTS5(db);
  fixture.cards.forEach((card, index) => {
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
      trust_label: 'user_confirmed',
      sensitivity: 'internal',
    };
    upsertCard(db, row);
    card.aliases.forEach(alias => insertAlias(db, card.id, alias));
    card.tags.forEach(tag => insertTag(db, card.id, tag));
    insertPath(db, card.id, card.source_path, 'source_file');
    refreshCardFts(db, { id: card.id, title: card.title, summary: card.summary, body: card.body, aliases: card.aliases, tags: card.tags });
  });
  return db;
}

function rank(ids: string[], relevantIds: readonly string[]): number {
  const relevant = new Set(relevantIds);
  const index = ids.findIndex(id => relevant.has(id));
  return index < 0 ? 0 : index + 1;
}

function ndcgAt10(ids: string[], relevantIds: readonly string[]): number {
  const position = rank(ids.slice(0, 10), relevantIds);
  return position === 0 ? 0 : 1 / Math.log2(position + 1);
}

function semanticDocuments() {
  return fixture.cards.map(card => ({
    id: card.id,
    type: card.type,
    status: 'active',
    title: card.title,
    summary: card.summary,
    body: `# ${card.title}\n\n${card.body}`,
    aliases: card.aliases,
    tags: card.tags,
    sourceFiles: [card.source_path],
    frontmatter: { trust_label: 'user_confirmed' as const, sensitivity: 'internal' as const },
  }));
}

describe('v1.2.0 live contextual retrieval evaluation', { skip: process.env.PMEM_RUN_SEMANTIC_EVAL !== '1' }, () => {
  it('meets the locked rerank quality, performance, and authority gates', async () => {
    const cachePath = process.env.PMEM_SEMANTIC_CACHE;
    assert.ok(cachePath, 'PMEM_SEMANTIC_CACHE must point at the cache prepared by `pmem semantic setup`');
    const provider = await createOfflineTransformersProvider({
      model: DEFAULT_SEMANTIC_MODEL,
      revision: DEFAULT_SEMANTIC_MODEL_REVISION,
      dtype: DEFAULT_SEMANTIC_DTYPE,
      dimension: DEFAULT_SEMANTIC_DIMENSION,
      cachePath,
    });
    const db = createFixtureDb();
    try {
      await rebuildSemanticIndex(db, semanticDocuments(), provider, { mode: 'full' });
      await provider.embedQuery('warmup');

      const oodResults = [];
      for (const query of oodFixture.queries) {
        const search = await searchSemanticCardsDetailed(db, query.query, provider, 20);
        oodResults.push({
          id: query.id,
          accepted: search.matches.length,
          abstained_reason: search.diagnostics.abstainedReason,
          top: round(search.diagnostics.topSimilarity ?? 0),
          margin: round((search.diagnostics.topSimilarity ?? 0) - (search.diagnostics.medianSimilarity ?? 0)),
          head_gap: round((search.diagnostics.topSimilarity ?? 0) - (search.diagnostics.runnerUpSimilarity ?? 0)),
        });
      }

      const results: Array<{ query: FixtureQuery; ids: string[]; baseIds: string[]; latency: number; baseLatency: number; semanticReason: string | null; semanticTop: number; semanticMargin: number; semanticHeadGap: number }> = [];
      for (const query of fixture.queries) {
        const semantic = await searchSemanticCardsDetailed(db, query.query, provider, 20);
        const baseStarted = performance.now();
        const base = await askQueryWithSemantic('.pmem', query.query, provider, {
          db,
          limit: 20,
          rerank: false,
          now: Date.parse('2026-07-24T00:00:00.000Z'),
        });
        const baseLatency = performance.now() - baseStarted;
        const started = performance.now();
        const response = await askQueryWithSemantic('.pmem', query.query, provider, {
          db,
          limit: 20,
          now: Date.parse('2026-07-24T00:00:00.000Z'),
        });
        results.push({
          query, ids: response.matched.map(match => match.id), baseIds: base.matched.map(match => match.id),
          latency: performance.now() - started, baseLatency,
          semanticReason: semantic.diagnostics.abstainedReason,
          semanticTop: round(semantic.diagnostics.topSimilarity ?? 0),
          semanticMargin: round((semantic.diagnostics.topSimilarity ?? 0) - (semantic.diagnostics.medianSimilarity ?? 0)),
          semanticHeadGap: round((semantic.diagnostics.topSimilarity ?? 0) - (semantic.diagnostics.runnerUpSimilarity ?? 0)),
        });
      }

      const metricsFor = (slice?: Slice, key: 'ids' | 'baseIds' = 'ids') => {
        const selected = slice ? results.filter(result => result.query.slice === slice) : results;
        let hits = 0;
        let reciprocal = 0;
        for (const result of selected) {
          const position = rank(result[key], result.query.relevant_ids);
          if (position > 0 && position <= 5) hits += 1;
          if (position > 0) reciprocal += 1 / position;
        }
        return { query_count: selected.length, recall_at_5: round(hits / selected.length), mrr: round(reciprocal / selected.length) };
      };

      let exactSuccess = 0;
      for (const card of fixture.cards as FixtureCard[]) {
        for (const exact of [card.id, card.title, card.source_path]) {
          const response = await askQueryWithSemantic('.pmem', exact, provider, { db, limit: 5 });
          if (response.matched[0]?.id === card.id) exactSuccess += 1;
        }
      }
      const latencies = results.map(result => result.latency).sort((a, b) => a - b);
      const baseLatencies = results.map(result => result.baseLatency).sort((a, b) => a - b);
      const overheads = results.map(result => result.latency - result.baseLatency).sort((a, b) => a - b);
      const candidateHits = results.filter(result => rank(result.baseIds, result.query.relevant_ids) > 0).length;

      const hardResults: Array<{ base: string[]; reranked: string[] }> = [];
      for (const query of hardNegatives.queries) {
        const base = await askQueryWithSemantic('.pmem', query.query, provider, { db, limit: 20, rerank: false });
        const reranked = await askQueryWithSemantic('.pmem', query.query, provider, { db, limit: 20 });
        hardResults.push({ base: base.matched.map(match => match.id), reranked: reranked.matched.map(match => match.id) });
      }
      const hardNdcg = (key: 'base' | 'reranked') => round(hardResults.reduce(
        (sum, result, index) => sum + ndcgAt10(result[key], hardNegatives.queries[index].relevant_ids), 0,
      ) / hardResults.length);

      const performanceDocuments = semanticDocuments();
      for (let index = fixture.cards.length; index < 300; index++) {
        const id = `module.synthetic_${String(index).padStart(3, '0')}`;
        const synthetic = {
          id,
          type: 'module',
          status: 'active',
          title: `Synthetic project memory ${index}`,
          summary: `Performance fixture card ${index} for the 300-card semantic index.`,
          body: `# Synthetic ${index}\n\nStable benchmark content about component ${index}, ownership, lifecycle, and verification.`,
          aliases: [],
          tags: ['performance'],
          sourceFiles: [`src/synthetic/${index}.ts`],
          frontmatter: { trust_label: 'user_confirmed' as const, sensitivity: 'internal' as const },
        };
        upsertCard(db, {
          id,
          type: 'module',
          title: synthetic.title,
          status: 'active',
          priority: null,
          file_path: `.pmem/modules/${id}.md`,
          summary: synthetic.summary,
          schema_version: '0.3',
          card_version: 1,
          created_at: '2026-07-24T00:00:00.000Z',
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
        });
        performanceDocuments.push(synthetic);
      }
      const buildStarted = performance.now();
      await rebuildSemanticIndex(db, performanceDocuments, provider, { mode: 'full' });
      const indexBuildMs = performance.now() - buildStarted;
      const performanceLatencies: number[] = [];
      for (const query of fixture.queries) {
        const started = performance.now();
        await askQueryWithSemantic('.pmem', query.query, provider, { db, limit: 20 });
        performanceLatencies.push(performance.now() - started);
      }
      performanceLatencies.sort((a, b) => a - b);

      const report = {
        fixture_version: fixture.fixture_version,
        evaluator: 'contextual-v1-live',
        model: DEFAULT_SEMANTIC_MODEL,
        revision: DEFAULT_SEMANTIC_MODEL_REVISION,
        dtype: DEFAULT_SEMANTIC_DTYPE,
        ...metricsFor(),
        pre_rerank: metricsFor(undefined, 'baseIds'),
        slices: {
          zh: metricsFor('zh'),
          en: metricsFor('en'),
          code_path_mixed: metricsFor('code_path_mixed'),
        },
        exact_query_success: { query_count: fixture.cards.length * 3, success_count: exactSuccess, success_rate: round(exactSuccess / (fixture.cards.length * 3)) },
        warm_query_latency_ms: {
          p50: round(percentile(latencies, 0.5), 3),
          p95: round(percentile(latencies, 0.95), 3),
          pre_rerank_p50: round(percentile(baseLatencies, 0.5), 3),
          pre_rerank_p95: round(percentile(baseLatencies, 0.95), 3),
          rerank_overhead_p50: round(percentile(overheads, 0.5), 3),
        },
        candidate_recall_at_50: round(candidateHits / results.length),
        performance_300_cards: {
          card_count: 300,
          chunk_count: 300,
          full_index_build_ms: round(indexBuildMs, 3),
          warm_query_p50_ms: round(percentile(performanceLatencies, 0.5), 3),
          warm_query_p95_ms: round(percentile(performanceLatencies, 0.95), 3),
        },
        hard_negatives: {
          fixture_version: hardNegatives.fixture_version,
          query_count: hardNegatives.queries.length,
          base_ndcg_at_10: hardNdcg('base'),
          reranked_ndcg_at_10: hardNdcg('reranked'),
          improvement: round(hardNdcg('reranked') - hardNdcg('base')),
        },
        ood: {
          fixture_version: oodFixture.fixture_version,
          query_count: oodResults.length,
          abstained_count: oodResults.filter(result => result.accepted === 0).length,
          leaked_ids: oodResults.filter(result => result.accepted > 0).map(result => result.id),
          details: oodResults,
        },
        semantic_gate_rejected_relevant_queries: results.filter(result => result.semanticReason).map(result => ({
          id: result.query.id, reason: result.semanticReason, top: result.semanticTop, margin: result.semanticMargin, head_gap: result.semanticHeadGap,
        })),
      };
      if (process.env.PMEM_PRINT_RERANK_DETAILS === '1') {
        process.stdout.write(`PMEM_RERANK_DETAILS=${JSON.stringify(results.map(result => ({
          id: result.query.id,
          query: result.query.query,
          relevant: result.query.relevant_ids,
          base_rank: rank(result.baseIds, result.query.relevant_ids),
          rerank_rank: rank(result.ids, result.query.relevant_ids),
        })))}\n`);
      }
      process.stdout.write(`PMEM_SEMANTIC_EVAL_REPORT=${JSON.stringify(report)}\n`);

      assert.ok(report.recall_at_5 >= baseline.semantic_acceptance.minimum_recall_at_5);
      assert.ok(report.mrr >= baseline.semantic_acceptance.minimum_mrr);
      assert.ok(report.slices.zh.recall_at_5 >= baseline.semantic_acceptance.minimum_slice_recall_at_5.zh);
      assert.ok(report.slices.en.recall_at_5 >= baseline.semantic_acceptance.minimum_slice_recall_at_5.en);
      assert.ok(report.slices.code_path_mixed.recall_at_5 >= baseline.semantic_acceptance.minimum_slice_recall_at_5.code_path_mixed);
      assert.equal(report.exact_query_success.success_rate, baseline.semantic_acceptance.required_exact_query_success_rate);
      assert.ok(report.recall_at_5 >= semanticBaseline.quality.recall_at_5);
      assert.ok(report.mrr >= semanticBaseline.quality.mrr + 0.02);
      assert.ok(report.mrr >= report.pre_rerank.mrr + 0.02);
      assert.equal(report.candidate_recall_at_50, 1);
      assert.equal(report.hard_negatives.query_count, 30);
      assert.ok(report.hard_negatives.reranked_ndcg_at_10 >= report.hard_negatives.base_ndcg_at_10 + 0.05);
      assert.equal(report.ood.abstained_count, report.ood.query_count, `OOD semantic leaks: ${report.ood.leaked_ids.join(', ')}`);
      assert.ok(report.performance_300_cards.full_index_build_ms <= semanticBaseline.performance_300_cards.full_index_build_ms * 1.25);
      assert.ok(report.performance_300_cards.warm_query_p95_ms <= 12);
      assert.ok(report.warm_query_latency_ms.rerank_overhead_p50 <= 2);
    } finally {
      db.close();
      await provider.dispose();
    }
  });
});
