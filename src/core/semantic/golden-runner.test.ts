import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runGoldenQuality,
  serializeGoldenQualityRun,
  type GoldenQualityRun,
} from './golden-runner';
import type { SemanticGoldenFixture } from './evaluation';

const fixture: SemanticGoldenFixture = {
  version: 1,
  name: 'runner-fixture',
  k: 2,
  queries: [
    { queryId: 'q1', query: 'first query', relevantIds: ['a'] },
    { queryId: 'q2', query: 'second query', relevantIds: ['b'] },
  ],
};

describe('semantic golden quality runner', () => {
  it('accepts object and JSON-string inputs without a Runtime dependency', () => {
    const result = runGoldenQuality(
      JSON.stringify(fixture),
      JSON.stringify([
        { queryId: 'q1', retrievedIds: ['a'], latencyMs: 4 },
        { queryId: 'q2', retrievedIds: ['b'], latencyMs: 6 },
      ]),
      { thresholds: { minCoverage: 1, minMeanRecallAtK: 1, maxP95LatencyMs: 10 } },
    );
    assert.equal(result.passed, true);
    assert.equal(result.status, 'passed');
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.failures, []);
    assert.equal(result.evaluation?.quality.aggregate.meanRecallAtK, 1);
  });

  it('returns machine-readable failures for threshold and completeness regressions', () => {
    const result = runGoldenQuality(
      fixture,
      [{ queryId: 'q1', retrievedIds: ['noise'], latencyMs: 25 }],
      { thresholds: { minCoverage: 1, maxP95LatencyMs: 10 } },
    );
    assert.equal(result.passed, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.failures.map(failure => failure.code), [
      'QUALITY_THRESHOLD',
      'QUALITY_THRESHOLD',
      'MISSING_QUERY_RESULTS',
    ]);
    assert.equal(result.failures[0]?.metric, 'coverage');
    assert.deepEqual(result.failures.at(-1)?.queryIds, ['q2']);
  });

  it('honors relaxed completeness options when constructing runner failures', () => {
    const missingRelaxed = runGoldenQuality(
      fixture,
      [{ queryId: 'q1', retrievedIds: ['a'] }],
      { requireCompleteResults: false },
    );
    assert.equal(missingRelaxed.passed, true);
    assert.equal(missingRelaxed.exitCode, 0);
    assert.deepEqual(missingRelaxed.failures, []);

    const unexpectedRelaxed = runGoldenQuality(
      fixture,
      [
        { queryId: 'q1', retrievedIds: ['a'] },
        { queryId: 'q2', retrievedIds: ['b'] },
        { queryId: 'future-query', retrievedIds: ['future'] },
      ],
      { rejectUnexpectedResults: false },
    );
    assert.equal(unexpectedRelaxed.passed, true);
    assert.equal(unexpectedRelaxed.exitCode, 0);
    assert.deepEqual(unexpectedRelaxed.failures, []);
  });

  it('returns exit code 2 for malformed fixture or capture input', () => {
    const badFixture = runGoldenQuality('{"version":1,"name":"bad","k":0,"queries":[]}', '[]');
    assert.equal(badFixture.status, 'invalid');
    assert.equal(badFixture.exitCode, 2);
    assert.equal(badFixture.failures[0]?.code, 'INVALID_INPUT');

    const badCapture = runGoldenQuality(fixture, '{not-json}');
    assert.equal(badCapture.status, 'invalid');
    assert.equal(badCapture.exitCode, 2);
    assert.match(badCapture.failures[0]?.message ?? '', /retrieval capture JSON/i);
  });

  it('serializes the result for CI artifacts and preserves the pass bit', () => {
    const result: GoldenQualityRun = runGoldenQuality(fixture, [
      { queryId: 'q1', retrievedIds: ['a'] },
      { queryId: 'q2', retrievedIds: ['b'] },
    ]);
    const parsed = JSON.parse(serializeGoldenQualityRun(result, false)) as GoldenQualityRun;
    assert.equal(parsed.passed, true);
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.evaluation?.fixture.name, 'runner-fixture');
  });
});
