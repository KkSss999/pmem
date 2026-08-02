import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUALITY_K,
  aggregateQuality,
  evaluateQuality,
  evaluateQuery,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  type QualityQueryCase,
  type QueryQualityResult,
} from './quality';

describe('semantic quality metrics', () => {
  const retrieved = ['a', 'noise', 'b', 'c'];
  const relevant = ['a', 'b', 'missing'];

  it('computes precision, recall, reciprocal rank and nDCG at a cutoff', () => {
    assert.equal(precisionAtK(retrieved, relevant, 3), 2 / 3);
    assert.equal(recallAtK(retrieved, relevant, 3), 2 / 3);
    assert.equal(reciprocalRank(retrieved, relevant, 3), 1);
    assert.ok(Math.abs(ndcgAtK(retrieved, relevant, 3) - 0.7039180890341347) < 1e-12);
  });

  it('uses zero for empty judgments and misses without throwing', () => {
    assert.equal(precisionAtK([], [], 3), 0);
    assert.equal(recallAtK(['a'], [], 3), 0);
    assert.equal(reciprocalRank(['a'], ['b'], 3), 0);
    assert.equal(ndcgAtK(['a'], ['b'], 3), 0);
  });

  it('deduplicates relevance hits while preserving rank order', () => {
    assert.equal(precisionAtK(['a', 'a', 'b'], ['a', 'b'], 3), 2 / 3);
    const result = evaluateQuery({ queryId: 'duplicates', relevantIds: ['a', 'b'], retrievedIds: ['a', 'a', 'b'] }, { k: 3 });
    assert.equal(result.metrics.hits, 2);
    assert.equal(result.metrics.recallAtK, 1);
    assert.equal(result.metrics.precisionAtK, 2 / 3);
    assert.equal(result.metrics.reciprocalRank, 1);
  });

  it('aggregates coverage, ranking metrics and only supplied latencies', () => {
    const queries: QualityQueryCase[] = [
      { queryId: 'one', relevantIds: ['a'], retrievedIds: ['a', 'x'], latencyMs: 10 },
      { queryId: 'two', relevantIds: ['b'], retrievedIds: ['x', 'b'], latencyMs: 30 },
      { queryId: 'three', relevantIds: [], retrievedIds: ['x'] },
    ];
    const report = evaluateQuality(queries, { k: 2 });
    assert.equal(report.version, 1);
    assert.equal(report.k, 2);
    assert.equal(report.aggregate.queryCount, 3);
    assert.equal(report.aggregate.judgedQueryCount, 2);
    assert.equal(report.aggregate.unjudgedQueryCount, 1);
    assert.equal(report.aggregate.coverage, 2 / 3);
    assert.equal(report.aggregate.meanRecallAtK, 2 / 3);
    assert.deepEqual(report.aggregate.latency, { count: 2, meanMs: 20, p50Ms: 10, p95Ms: 30, maxMs: 30 });
  });

  it('returns a zero-valued aggregate for an empty evaluation set', () => {
    const aggregate = aggregateQuality([]);
    assert.equal(aggregate.queryCount, 0);
    assert.equal(aggregate.coverage, 0);
    assert.equal(aggregate.meanNdcgAtK, 0);
    assert.deepEqual(aggregate.latency, { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null });
  });

  it('rejects invalid cutoffs and latency values', () => {
    assert.throws(() => precisionAtK([], [], 0), /positive integer/);
    assert.throws(() => evaluateQuality([], { k: 1.5 }), /positive integer/);
    assert.throws(() => evaluateQuery({ queryId: 'bad', relevantIds: [], retrievedIds: [], latencyMs: -1 }), /non-negative/);
    assert.throws(() => evaluateQuery({ queryId: 'bad', relevantIds: [], retrievedIds: [], latencyMs: Number.NaN }), /finite/);
  });

  it('uses the documented default cutoff', () => {
    assert.equal(evaluateQuery({ queryId: 'default', relevantIds: ['a'], retrievedIds: ['a'] }).k, DEFAULT_QUALITY_K);
  });
});

// Keep the result shape checked by TypeScript as part of the contract.
const _qualityResultShape: QueryQualityResult | undefined = undefined;
void _qualityResultShape;
