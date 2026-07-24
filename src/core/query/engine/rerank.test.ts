import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CardRow } from '../../../types';
import { buildQueryPlan } from './queryPlan';
import { parseIntent } from './intent';
import { rerankCandidates } from './rerank';
import type { ScoredResult } from './scoring';

function result(id: string, score: number, channel: ScoredResult['reasons'][number]['channel'], overrides: Partial<ScoredResult> = {}): ScoredResult {
  const card: CardRow = {
    id,
    type: 'module',
    title: id,
    status: 'active',
    priority: null,
    file_path: `.pmem/modules/${id}.md`,
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
  };
  return {
    card,
    score,
    base: score,
    reasons: [{ channel, detail: channel, base: score }],
    graph_distance: 0,
    stale: false,
    factors: { type_weight: 1, recency: 1, staleness: 1, status: 1, confidence: 1, superseded: 1 },
    ...overrides,
  };
}

function plan(query: string) {
  return buildQueryPlan(parseIntent(query, ['module', 'decision', 'trace', 'risk']));
}

describe('v1.2 contextual reranking', () => {
  it('keeps exact id, title, and path authority at their original ranks', () => {
    const exactId = result('decision.exact', 0.2, 'exact_id');
    const exactTitle = result('decision.title', 0.2, 'exact_title');
    const exactPath = result('module.path', 0.2, 'source_file');
    const semantic = result('module.semantic', 0.95, 'semantic', {
      rerank_text: 'authentication credential target',
      reasons: [{ channel: 'semantic', detail: 'semantic', base: 0.95, similarity: 0.99 }],
    });
    const ranked = rerankCandidates([exactId, exactTitle, exactPath, semantic], plan('authentication credential'));
    assert.deepEqual(ranked.map(item => item.card.id), ['decision.exact', 'decision.title', 'module.path', 'module.semantic']);
  });

  it('reranks contextual evidence but preserves graph provenance and caps graph inheritance', () => {
    const seed = result('module.seed', 0.8, 'semantic', {
      rerank_text: 'authentication credential boundary',
      reasons: [{ channel: 'semantic', detail: 'semantic', base: 0.8, similarity: 0.85 }],
    });
    const weak = result('module.weak', 0.79, 'fts', { rerank_text: 'unrelated storage' });
    const graph = result('module.graph', 0.7, 'graph', {
      graph_distance: 1,
      edge_type: 'depends_on',
      from_card: 'module.seed',
      rerank_text: 'authentication credential boundary',
    });
    const ranked = rerankCandidates([weak, seed, graph], plan('authentication credential'));
    assert.equal(ranked[0].card.id, 'module.seed');
    const graphResult = ranked.find(item => item.card.id === 'module.graph')!;
    assert.equal(graphResult.edge_type, 'depends_on');
    assert.equal(graphResult.from_card, 'module.seed');
    assert.equal(graphResult.reasons[0].channel, 'graph');
    assert.ok(graphResult.rerank!.score <= (seed.score / 1.15) * 0.75 + 1e-6);
  });

  it('is deterministic for tied factors', () => {
    const left = result('module.b', 0.7, 'fts');
    const right = result('module.a', 0.7, 'fts');
    const first = rerankCandidates([left, right], plan('unknown')).map(item => item.card.id);
    const second = rerankCandidates([left, right], plan('unknown')).map(item => item.card.id);
    assert.deepEqual(first, second);
    assert.deepEqual(first, ['module.b', 'module.a'], 'original rank is the stable tie-breaker');
  });
});
