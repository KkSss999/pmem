import {
  evaluateGoldenFixture,
  parseGoldenFixture,
  type GoldenEvaluationOptions,
  type SemanticGoldenEvaluation,
  type SemanticGoldenFixture,
  type SemanticGoldenRetrieval,
  type QualityGateMetric,
} from './evaluation';

export type GoldenRunnerInput = SemanticGoldenFixture | string;
export type GoldenRetrievalCaptureInput = readonly SemanticGoldenRetrieval[] | string;
export type GoldenRunnerStatus = 'passed' | 'failed' | 'invalid';
export type GoldenRunnerExitCode = 0 | 1 | 2;

export type GoldenRunnerFailureCode =
  | 'QUALITY_THRESHOLD'
  | 'MISSING_QUERY_RESULTS'
  | 'UNEXPECTED_QUERY_RESULTS'
  | 'INVALID_INPUT';

export interface GoldenRunnerFailure {
  code: GoldenRunnerFailureCode;
  message: string;
  metric?: QualityGateMetric;
  actual?: number | null;
  expected?: number;
  queryIds?: readonly string[];
}
export interface GoldenQualityRun {
  /** `passed` is the machine-readable success bit for CI callers. */
  passed: boolean;
  status: GoldenRunnerStatus;
  /** 0 = pass, 1 = quality/completeness regression, 2 = malformed input. */
  exitCode: GoldenRunnerExitCode;
  failures: readonly GoldenRunnerFailure[];
  evaluation?: SemanticGoldenEvaluation;
}

function parseRetrievalCapture(input: GoldenRetrievalCaptureInput): readonly SemanticGoldenRetrieval[] {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new TypeError(`Invalid retrieval capture JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!Array.isArray(value)) throw new TypeError('Retrieval capture must be an array');
  return value as SemanticGoldenRetrieval[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evaluateFailures(evaluation: SemanticGoldenEvaluation): GoldenRunnerFailure[] {
  const failures: GoldenRunnerFailure[] = [];
  const failedChecks = evaluation.gate.checks.filter(check => !check.passed);
  for (const check of failedChecks) {
    failures.push({
      code: 'QUALITY_THRESHOLD',
      message: `${check.metric} ${check.operator} ${String(check.expected)} failed (actual ${String(check.actual)})`,
      metric: check.metric,
      actual: check.actual,
      expected: check.expected,
    });
  }
  if (evaluation.missingQueryIds.length > 0) {
    failures.push({
      code: 'MISSING_QUERY_RESULTS',
      message: `Missing retrieval captures for ${evaluation.missingQueryIds.length} golden quer${evaluation.missingQueryIds.length === 1 ? 'y' : 'ies'}`,
      queryIds: evaluation.missingQueryIds,
    });
  }
  if (evaluation.unexpectedQueryIds.length > 0) {
    failures.push({
      code: 'UNEXPECTED_QUERY_RESULTS',
      message: `Retrieval captures contain ${evaluation.unexpectedQueryIds.length} query id${evaluation.unexpectedQueryIds.length === 1 ? '' : 's'} not present in the fixture`,
      queryIds: evaluation.unexpectedQueryIds,
    });
  }
  return failures;
}

/**
 * Run a fully offline golden quality regression check.
 *
 * The inputs may be in-memory values or JSON strings, so a CI job can feed a
 * checked-in fixture and a captured Runtime output without starting a model,
 * database, or network service. Invalid input is reported as exit code 2;
 * quality or completeness regressions are reported as exit code 1.
 */
export function runGoldenQuality(
  fixtureInput: GoldenRunnerInput,
  retrievalCaptureInput: GoldenRetrievalCaptureInput,
  options: GoldenEvaluationOptions = {},
): GoldenQualityRun {
  try {
    const fixture = parseGoldenFixture(fixtureInput);
    const retrievals = parseRetrievalCapture(retrievalCaptureInput);
    const evaluation = evaluateGoldenFixture(fixture, retrievals, options);
    const failures = evaluateFailures(evaluation);
    return {
      passed: failures.length === 0,
      status: failures.length === 0 ? 'passed' : 'failed',
      exitCode: failures.length === 0 ? 0 : 1,
      failures,
      evaluation,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      passed: false,
      status: 'invalid',
      exitCode: 2,
      failures: [{ code: 'INVALID_INPUT', message }],
    };
  }
}

/** Stable JSON output suitable for a CI artifact or a machine consumer. */
export function serializeGoldenQualityRun(result: GoldenQualityRun, pretty = true): string {
  return JSON.stringify(result, null, pretty ? 2 : 0);
}
