import {
  evaluateQuality,
  type QualityEvaluationOptions,
  type QualityQueryCase,
  type SemanticQualityReport,
} from './quality';

/** Version of the on-disk golden-query fixture contract. */
export const SEMANTIC_GOLDEN_FIXTURE_VERSION = 1 as const;

export interface SemanticGoldenQuery {
  /** Stable id used to join judgments and retrieval results. */
  queryId: string;
  /** Human-readable query sent to the Runtime. */
  query: string;
  /** Authoritative relevant record ids for this query. */
  relevantIds: readonly string[];
  /** Optional labels for filtering or reporting a golden set. */
  tags?: readonly string[];
}

export interface SemanticGoldenFixture {
  version: typeof SEMANTIC_GOLDEN_FIXTURE_VERSION;
  /** Stable fixture name, for example `agent-workflow-v1`. */
  name: string;
  /** Default evaluation cutoff for this fixture. */
  k: number;
  queries: readonly SemanticGoldenQuery[];
}

/** A model-independent result captured from a Runtime query. */
export interface SemanticGoldenRetrieval {
  queryId: string;
  retrievedIds: readonly string[];
  latencyMs?: number;
  /** Optional packed-token cost aligned with retrievedIds for context metrics. */
  retrievedTokenWeights?: readonly number[];
}

export interface SemanticQualityThresholds {
  minCoverage?: number;
  minMeanPrecisionAtK?: number;
  minMeanRecallAtK?: number;
  minMeanReciprocalRank?: number;
  minMeanNdcgAtK?: number;
  minMeanContextTokenEfficiency?: number;
  maxMeanNoiseRatioAtK?: number;
  maxP95LatencyMs?: number;
}

export type QualityGateMetric =
  | 'coverage'
  | 'meanPrecisionAtK'
  | 'meanRecallAtK'
  | 'meanReciprocalRank'
  | 'meanNdcgAtK'
  | 'meanContextTokenEfficiency'
  | 'meanNoiseRatioAtK'
  | 'p95LatencyMs';

export interface SemanticQualityGateCheck {
  metric: QualityGateMetric;
  actual: number | null;
  operator: '>=' | '<=';
  expected: number;
  passed: boolean;
}

export interface SemanticQualityGate {
  passed: boolean;
  checks: readonly SemanticQualityGateCheck[];
}

export interface GoldenEvaluationOptions extends QualityEvaluationOptions {
  thresholds?: SemanticQualityThresholds;
  /** Missing fixture results fail the gate; defaults to true. */
  requireCompleteResults?: boolean;
  /** Results for ids not present in the fixture fail the gate; defaults to true. */
  rejectUnexpectedResults?: boolean;
}

export interface SemanticGoldenEvaluation {
  fixture: SemanticGoldenFixture;
  quality: SemanticQualityReport;
  gate: SemanticQualityGate;
  missingQueryIds: readonly string[];
  unexpectedQueryIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertIds(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
}

function assertK(k: number): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`Golden fixture k must be a positive integer, received ${String(k)}`);
  }
}

function assertThreshold(value: number | undefined, field: string, range: 'ratio' | 'latency'): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || (range === 'ratio' ? value < 0 || value > 1 : value < 0)) {
    throw new RangeError(`${field} must be a finite ${range === 'ratio' ? 'ratio between 0 and 1' : 'non-negative number'}`);
  }
}

function assertUnique(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${field} must not contain duplicate id ${value}`);
    seen.add(value);
  }
}

/** Validate and defensively copy a golden fixture before evaluation or persistence. */
export function normalizeGoldenFixture(input: SemanticGoldenFixture): SemanticGoldenFixture {
  if (!isRecord(input) || input.version !== SEMANTIC_GOLDEN_FIXTURE_VERSION) {
    throw new TypeError(`Golden fixture version must be ${SEMANTIC_GOLDEN_FIXTURE_VERSION}`);
  }
  assertNonEmptyString(input.name, 'Golden fixture name');
  if (!Array.isArray(input.queries)) throw new TypeError('Golden fixture queries must be an array');
  assertK(input.k);

  const queries = input.queries.map((raw, index): SemanticGoldenQuery => {
    if (!isRecord(raw)) throw new TypeError(`Golden query at index ${index} must be an object`);
    assertNonEmptyString(raw.queryId, `Golden query ${index} queryId`);
    assertNonEmptyString(raw.query, `Golden query ${raw.queryId} query`);
    assertIds(raw.relevantIds, `Golden query ${raw.queryId} relevantIds`);
    assertUnique(raw.relevantIds, `Golden query ${raw.queryId} relevantIds`);
    if (raw.tags !== undefined) {
      assertIds(raw.tags, `Golden query ${raw.queryId} tags`);
      assertUnique(raw.tags, `Golden query ${raw.queryId} tags`);
    }
    return {
      queryId: raw.queryId,
      query: raw.query,
      relevantIds: [...raw.relevantIds],
      ...(raw.tags === undefined ? {} : { tags: [...raw.tags] }),
    };
  });
  assertUnique(queries.map(query => query.queryId), 'Golden fixture queries');
  return {
    version: SEMANTIC_GOLDEN_FIXTURE_VERSION,
    name: input.name,
    k: input.k,
    // Stable ids make serialized fixtures and reports review-friendly.
    queries: queries.sort((a, b) => (a.queryId < b.queryId ? -1 : a.queryId > b.queryId ? 1 : 0)),
  };
}

/** Parse a JSON fixture and apply the same validation as an in-memory fixture. */
export function parseGoldenFixture(input: string | unknown): SemanticGoldenFixture {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new TypeError(`Invalid golden fixture JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return normalizeGoldenFixture(value as SemanticGoldenFixture);
}

/** Serialize a fixture with stable query ordering for checked-in golden files. */
export function serializeGoldenFixture(fixture: SemanticGoldenFixture, pretty = true): string {
  const normalized = normalizeGoldenFixture(fixture);
  return JSON.stringify(normalized, null, pretty ? 2 : 0);
}

function validateRetrieval(value: SemanticGoldenRetrieval, index: number): SemanticGoldenRetrieval {
  if (!isRecord(value)) throw new TypeError(`Golden retrieval at index ${index} must be an object`);
  assertNonEmptyString(value.queryId, `Golden retrieval ${index} queryId`);
  assertIds(value.retrievedIds, `Golden retrieval ${value.queryId} retrievedIds`);
  if (value.latencyMs !== undefined && (!Number.isFinite(value.latencyMs) || value.latencyMs < 0)) {
    throw new RangeError(`Golden retrieval ${value.queryId} latencyMs must be finite and non-negative`);
  }
  if (value.retrievedTokenWeights !== undefined && (!Array.isArray(value.retrievedTokenWeights)
    || value.retrievedTokenWeights.some(weight => !Number.isFinite(weight) || weight < 0))) {
    throw new RangeError(`Golden retrieval ${value.queryId} retrievedTokenWeights must be finite non-negative numbers`);
  }
  if (value.retrievedTokenWeights !== undefined && value.retrievedTokenWeights.length !== value.retrievedIds.length) {
    throw new RangeError(`Golden retrieval ${value.queryId} retrievedTokenWeights must align one-to-one with retrievedIds`);
  }
  return {
    queryId: value.queryId,
    retrievedIds: [...value.retrievedIds],
    ...(value.latencyMs === undefined ? {} : { latencyMs: value.latencyMs }),
    ...(value.retrievedTokenWeights === undefined ? {} : { retrievedTokenWeights: [...value.retrievedTokenWeights] }),
  };
}

function checkThreshold(
  metric: QualityGateMetric,
  actual: number | null,
  operator: '>=' | '<=',
  expected: number,
): SemanticQualityGateCheck {
  return {
    metric,
    actual,
    operator,
    expected,
    passed: actual !== null && (operator === '>=' ? actual >= expected : actual <= expected),
  };
}

function evaluateGate(
  report: SemanticQualityReport,
  thresholds: SemanticQualityThresholds,
): SemanticQualityGate {
  assertThreshold(thresholds.minCoverage, 'minCoverage', 'ratio');
  assertThreshold(thresholds.minMeanPrecisionAtK, 'minMeanPrecisionAtK', 'ratio');
  assertThreshold(thresholds.minMeanRecallAtK, 'minMeanRecallAtK', 'ratio');
  assertThreshold(thresholds.minMeanReciprocalRank, 'minMeanReciprocalRank', 'ratio');
  assertThreshold(thresholds.minMeanNdcgAtK, 'minMeanNdcgAtK', 'ratio');
  assertThreshold(thresholds.minMeanContextTokenEfficiency, 'minMeanContextTokenEfficiency', 'ratio');
  assertThreshold(thresholds.maxMeanNoiseRatioAtK, 'maxMeanNoiseRatioAtK', 'ratio');
  assertThreshold(thresholds.maxP95LatencyMs, 'maxP95LatencyMs', 'latency');

  const aggregate = report.aggregate;
  const checks: SemanticQualityGateCheck[] = [];
  if (thresholds.minCoverage !== undefined) checks.push(checkThreshold('coverage', aggregate.coverage, '>=', thresholds.minCoverage));
  if (thresholds.minMeanPrecisionAtK !== undefined) checks.push(checkThreshold('meanPrecisionAtK', aggregate.meanPrecisionAtK, '>=', thresholds.minMeanPrecisionAtK));
  if (thresholds.minMeanRecallAtK !== undefined) checks.push(checkThreshold('meanRecallAtK', aggregate.meanRecallAtK, '>=', thresholds.minMeanRecallAtK));
  if (thresholds.minMeanReciprocalRank !== undefined) checks.push(checkThreshold('meanReciprocalRank', aggregate.meanReciprocalRank, '>=', thresholds.minMeanReciprocalRank));
  if (thresholds.minMeanNdcgAtK !== undefined) checks.push(checkThreshold('meanNdcgAtK', aggregate.meanNdcgAtK, '>=', thresholds.minMeanNdcgAtK));
  if (thresholds.minMeanContextTokenEfficiency !== undefined) checks.push(checkThreshold('meanContextTokenEfficiency', aggregate.meanContextTokenEfficiency, '>=', thresholds.minMeanContextTokenEfficiency));
  if (thresholds.maxMeanNoiseRatioAtK !== undefined) checks.push(checkThreshold('meanNoiseRatioAtK', aggregate.meanNoiseRatioAtK, '<=', thresholds.maxMeanNoiseRatioAtK));
  if (thresholds.maxP95LatencyMs !== undefined) checks.push(checkThreshold('p95LatencyMs', aggregate.latency.p95Ms, '<=', thresholds.maxP95LatencyMs));
  return { passed: checks.every(check => check.passed), checks };
}

/**
 * Adapt captured Runtime results to the quality harness and evaluate a gate.
 * Missing fixture results are represented as empty ranked lists, so recall
 * regressions are visible even before the completeness gate is considered.
 */
export function evaluateGoldenFixture(
  fixtureInput: SemanticGoldenFixture,
  retrievalsInput: readonly SemanticGoldenRetrieval[],
  options: GoldenEvaluationOptions = {},
): SemanticGoldenEvaluation {
  const fixture = normalizeGoldenFixture(fixtureInput);
  const retrievals = retrievalsInput.map(validateRetrieval);
  assertUnique(retrievals.map(result => result.queryId), 'Golden retrievals');
  const fixtureIds = new Set(fixture.queries.map(query => query.queryId));
  const retrievalById = new Map(retrievals.map(result => [result.queryId, result]));
  const missingQueryIds = fixture.queries.filter(query => !retrievalById.has(query.queryId)).map(query => query.queryId);
  const unexpectedQueryIds = retrievals.filter(result => !fixtureIds.has(result.queryId)).map(result => result.queryId);
  const qualityCases: QualityQueryCase[] = fixture.queries.map(query => {
    const result = retrievalById.get(query.queryId);
    return {
      queryId: query.queryId,
      relevantIds: query.relevantIds,
      retrievedIds: result?.retrievedIds ?? [],
      latencyMs: result?.latencyMs,
      retrievedTokenWeights: result?.retrievedTokenWeights,
    };
  });
  const quality = evaluateQuality(qualityCases, { k: options.k ?? fixture.k });
  const gate = evaluateGate(quality, options.thresholds ?? {});
  const requireCompleteResults = options.requireCompleteResults ?? true;
  const rejectUnexpectedResults = options.rejectUnexpectedResults ?? true;
  return {
    fixture,
    quality,
    gate: {
      ...gate,
      passed:
        gate.passed &&
        (!requireCompleteResults || missingQueryIds.length === 0) &&
        (!rejectUnexpectedResults || unexpectedQueryIds.length === 0),
    },
    missingQueryIds,
    unexpectedQueryIds,
  };
}
