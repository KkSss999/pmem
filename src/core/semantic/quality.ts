/**
 * Pure, deterministic quality measurements for semantic retrieval.
 *
 * The harness deliberately accepts ranked ids rather than database rows.  It
 * can therefore evaluate a live Runtime result, a golden fixture, or a saved
 * evaluation without coupling quality reporting to a storage adapter.
 */

export const SEMANTIC_QUALITY_VERSION = 1;
export const DEFAULT_QUALITY_K = 10;

export interface QualityQueryCase {
  /** Stable id for the query in a golden set. */
  queryId: string;
  /** Relevant result ids, in no particular order. */
  relevantIds: readonly string[];
  /** Result ids in the order returned by the retriever. */
  retrievedIds: readonly string[];
  /** Optional end-to-end retrieval latency in milliseconds. */
  latencyMs?: number;
  /** Optional packed-token cost aligned with retrievedIds for context metrics. */
  retrievedTokenWeights?: readonly number[];
}

export interface QualityEvaluationOptions {
  /** Cutoff used by precision, recall and nDCG. Defaults to 10. */
  k?: number;
}

export interface QueryQualityMetrics {
  /** Number of distinct relevant ids in the judgment set. */
  relevantCount: number;
  /** Number of relevant ids found in the first k results. */
  hits: number;
  /** hits / k. Missing result slots count as non-relevant. */
  precisionAtK: number;
  /** hits / relevantCount; zero when the query has no judgments. */
  recallAtK: number;
  /** 1 / rank of the first relevant result, or zero when absent. */
  reciprocalRank: number;
  /** Binary-gain normalized discounted cumulative gain at k. */
  ndcgAtK: number;
  /** Whether at least one relevant result was retrieved in the first k. */
  covered: boolean;
  /** Relevant packed-token weight divided by total packed-token weight at k. */
  contextTokenEfficiency: number;
  /** Irrelevant packed-token weight divided by total packed-token weight at k. */
  noiseRatioAtK: number;
}

export interface QueryQualityResult {
  queryId: string;
  k: number;
  metrics: QueryQualityMetrics;
  latencyMs: number | null;
}

export interface LatencySummary {
  count: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface QualityAggregate {
  /** Number of query cases supplied, including cases without judgments. */
  queryCount: number;
  /** Number of cases with at least one relevant id. */
  judgedQueryCount: number;
  /** Number of cases with no relevant ids. */
  unjudgedQueryCount: number;
  /** Fraction of all cases with a relevant hit in the first k. */
  coverage: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  meanReciprocalRank: number;
  meanNdcgAtK: number;
  meanContextTokenEfficiency: number;
  meanNoiseRatioAtK: number;
  latency: LatencySummary;
}

export interface SemanticQualityReport {
  version: typeof SEMANTIC_QUALITY_VERSION;
  k: number;
  queries: QueryQualityResult[];
  aggregate: QualityAggregate;
}

function assertK(k: number): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`Quality cutoff k must be a positive integer, received ${String(k)}`);
  }
}

function assertLatency(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Query latency must be a finite non-negative number, received ${String(value)}`);
  }
  return value;
}

function tokenWeights(query: QualityQueryCase, k: number): number[] {
  const supplied = query.retrievedTokenWeights;
  if (supplied !== undefined && supplied.some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(`Query token weights must be finite non-negative numbers, received ${String(supplied)}`);
  }
  if (supplied !== undefined && supplied.length !== query.retrievedIds.length) {
    throw new RangeError('Query token weights must align one-to-one with retrievedIds');
  }
  return query.retrievedIds.slice(0, k).map((_, index) => supplied?.[index] ?? 1);
}

/** Relevant context-token share at the evaluation cutoff. */
export function contextTokenEfficiency(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  retrievedTokenWeights?: readonly number[],
  k: number = DEFAULT_QUALITY_K,
): number {
  assertK(k);
  if (retrievedTokenWeights?.some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Retrieved token weights must be finite non-negative numbers');
  }
  if (retrievedTokenWeights !== undefined && retrievedTokenWeights.length !== retrievedIds.length) {
    throw new RangeError('Retrieved token weights must align one-to-one with retrievedIds');
  }
  const relevant = relevantSet(relevantIds);
  const ranked = retrievedIds.slice(0, k);
  const weights = ranked.map((_, index) => retrievedTokenWeights?.[index] ?? 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const seen = new Set<string>();
  const relevantWeight = ranked.reduce((sum, id, index) => {
    const duplicate = seen.has(id);
    seen.add(id);
    return sum + (relevant.has(id) && !duplicate ? weights[index] : 0);
  }, 0);
  return relevantWeight / total;
}

/** Irrelevant context-token share at the evaluation cutoff. */
export function noiseRatioAtK(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  retrievedTokenWeights?: readonly number[],
  k: number = DEFAULT_QUALITY_K,
): number {
  return 1 - contextTokenEfficiency(retrievedIds, relevantIds, retrievedTokenWeights, k);
}

function relevantSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

/** Precision at k for a ranked list and binary relevance judgments. */
export function precisionAtK(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  k: number = DEFAULT_QUALITY_K,
): number {
  assertK(k);
  const relevant = relevantSet(relevantIds);
  const hits = new Set(retrievedIds.slice(0, k).filter(id => relevant.has(id))).size;
  return hits / k;
}

/** Recall at k for a ranked list and binary relevance judgments. */
export function recallAtK(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  k: number = DEFAULT_QUALITY_K,
): number {
  assertK(k);
  const relevant = relevantSet(relevantIds);
  if (relevant.size === 0) return 0;
  const hits = new Set(retrievedIds.slice(0, k).filter(id => relevant.has(id))).size;
  return hits / relevant.size;
}

/** Mean reciprocal rank for the first relevant result in a ranked list. */
export function reciprocalRank(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  k: number = DEFAULT_QUALITY_K,
): number {
  assertK(k);
  const relevant = relevantSet(relevantIds);
  const rank = retrievedIds.slice(0, k).findIndex(id => relevant.has(id));
  return rank < 0 ? 0 : 1 / (rank + 1);
}

/** Binary-gain nDCG at k. A query without judgments has nDCG zero. */
export function ndcgAtK(
  retrievedIds: readonly string[],
  relevantIds: readonly string[],
  k: number = DEFAULT_QUALITY_K,
): number {
  assertK(k);
  const relevant = relevantSet(relevantIds);
  if (relevant.size === 0) return 0;

  const ranked = retrievedIds.slice(0, k);
  const seen = new Set<string>();
  let dcg = 0;
  for (const [index, id] of ranked.entries()) {
    // A duplicate result must not earn relevance twice.
    if (relevant.has(id) && !seen.has(id)) {
      dcg += 1 / Math.log2(index + 2);
      seen.add(id);
    }
  }

  const idealHits = Math.min(relevant.size, k);
  let idcg = 0;
  for (let index = 0; index < idealHits; index++) idcg += 1 / Math.log2(index + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Evaluate one golden query case without side effects. */
export function evaluateQuery(
  query: QualityQueryCase,
  options: QualityEvaluationOptions = {},
): QueryQualityResult {
  const k = options.k ?? DEFAULT_QUALITY_K;
  assertK(k);
  const relevant = relevantSet(query.relevantIds);
  const ranked = query.retrievedIds.slice(0, k);
  const hits = new Set(ranked.filter(id => relevant.has(id))).size;
  const weights = tokenWeights(query, k);
  return {
    queryId: query.queryId,
    k,
    metrics: {
      relevantCount: relevant.size,
      hits,
      precisionAtK: hits / k,
      recallAtK: relevant.size === 0 ? 0 : hits / relevant.size,
      reciprocalRank: reciprocalRank(query.retrievedIds, query.relevantIds, k),
      ndcgAtK: ndcgAtK(query.retrievedIds, query.relevantIds, k),
      covered: hits > 0,
      contextTokenEfficiency: contextTokenEfficiency(query.retrievedIds, query.relevantIds, weights, k),
      noiseRatioAtK: noiseRatioAtK(query.retrievedIds, query.relevantIds, weights, k),
    },
    latencyMs: assertLatency(query.latencyMs),
  };
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  // Nearest-rank keeps the summary deterministic for small golden sets.
  const index = Math.ceil(quantile * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/** Aggregate query-level results into a stable quality and latency summary. */
export function aggregateQuality(results: readonly QueryQualityResult[]): QualityAggregate {
  const judged = results.filter(result => result.metrics.relevantCount > 0);
  const latencyValues = results
    .map(result => result.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const sum = (selector: (result: QueryQualityResult) => number): number =>
    results.reduce((total, result) => total + selector(result), 0);
  const queryCount = results.length;
  return {
    queryCount,
    judgedQueryCount: judged.length,
    unjudgedQueryCount: queryCount - judged.length,
    coverage: queryCount === 0 ? 0 : results.filter(result => result.metrics.covered).length / queryCount,
    meanPrecisionAtK: queryCount === 0 ? 0 : sum(result => result.metrics.precisionAtK) / queryCount,
    meanRecallAtK: queryCount === 0 ? 0 : sum(result => result.metrics.recallAtK) / queryCount,
    meanReciprocalRank: queryCount === 0 ? 0 : sum(result => result.metrics.reciprocalRank) / queryCount,
    meanNdcgAtK: queryCount === 0 ? 0 : sum(result => result.metrics.ndcgAtK) / queryCount,
    meanContextTokenEfficiency: queryCount === 0 ? 0 : sum(result => result.metrics.contextTokenEfficiency) / queryCount,
    meanNoiseRatioAtK: queryCount === 0 ? 0 : sum(result => result.metrics.noiseRatioAtK) / queryCount,
    latency: {
      count: latencyValues.length,
      meanMs: latencyValues.length === 0 ? null : latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length,
      p50Ms: percentile(latencyValues, 0.5),
      p95Ms: percentile(latencyValues, 0.95),
      maxMs: latencyValues.length === 0 ? null : latencyValues[latencyValues.length - 1],
    },
  };
}

/** Run the complete deterministic evaluation harness for a golden query set. */
export function evaluateQuality(
  queries: readonly QualityQueryCase[],
  options: QualityEvaluationOptions = {},
): SemanticQualityReport {
  const k = options.k ?? DEFAULT_QUALITY_K;
  assertK(k);
  const results = queries.map(query => evaluateQuery(query, { k }));
  return {
    version: SEMANTIC_QUALITY_VERSION,
    k,
    queries: results,
    aggregate: aggregateQuality(results),
  };
}
