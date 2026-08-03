import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGoldenFixture,
  normalizeGoldenFixture,
  parseGoldenFixture,
  serializeGoldenFixture,
  type SemanticGoldenFixture,
} from './evaluation';

const fixture: SemanticGoldenFixture = {
  version: 1,
  name: 'agent-workflow-v1',
  k: 3,
  queries: [
    { queryId: 'payments', query: 'Why are payments timing out?', relevantIds: ['incident-payment', 'decision-retry'], tags: ['incident'] },
    { queryId: 'deploy', query: 'How do we deploy?', relevantIds: ['runbook-deploy'] },
  ],
};

describe('semantic golden evaluation', () => {
  it('normalizes query order and round-trips a serializable fixture', () => {
    const normalized = normalizeGoldenFixture(fixture);
    assert.deepEqual(normalized.queries.map(query => query.queryId), ['deploy', 'payments']);
    const json = serializeGoldenFixture(fixture, false);
    assert.deepEqual(parseGoldenFixture(json), normalized);
  });

  it('evaluates captured retrievals without a model or network', () => {
    const result = evaluateGoldenFixture(
      fixture,
      [
        { queryId: 'payments', retrievedIds: ['noise', 'incident-payment'], latencyMs: 12 },
        { queryId: 'deploy', retrievedIds: ['runbook-deploy'], latencyMs: 8 },
      ],
      { thresholds: { minCoverage: 1, minMeanRecallAtK: 0.75, maxP95LatencyMs: 20 } },
    );
    assert.equal(result.gate.passed, true);
    assert.equal(result.quality.aggregate.coverage, 1);
    assert.equal(result.quality.aggregate.meanRecallAtK, 0.75);
    assert.deepEqual(result.missingQueryIds, []);
    assert.deepEqual(result.unexpectedQueryIds, []);
  });

  it('gates context efficiency and noise from captured token weights', () => {
    const result = evaluateGoldenFixture(
      fixture,
      [
        { queryId: 'payments', retrievedIds: ['incident-payment', 'noise'], retrievedTokenWeights: [10, 30] },
        { queryId: 'deploy', retrievedIds: ['runbook-deploy'], retrievedTokenWeights: [5] },
      ],
      { thresholds: { minMeanContextTokenEfficiency: 0.5, maxMeanNoiseRatioAtK: 0.5 } },
    );
    assert.equal(result.gate.passed, true);
    assert.equal(result.quality.aggregate.meanContextTokenEfficiency, 0.625);
    assert.equal(result.quality.aggregate.meanNoiseRatioAtK, 0.375);
  });

  it('fails a regression gate when a required query is missing or below threshold', () => {
    const result = evaluateGoldenFixture(
      fixture,
      [{ queryId: 'payments', retrievedIds: ['noise'], latencyMs: 50 }],
      { thresholds: { minCoverage: 1, maxP95LatencyMs: 20 } },
    );
    assert.equal(result.gate.passed, false);
    assert.deepEqual(result.missingQueryIds, ['deploy']);
    assert.deepEqual(result.gate.checks.map(check => check.passed), [false, false]);
  });

  it('rejects duplicate and unexpected result ids by default', () => {
    assert.throws(
      () => evaluateGoldenFixture(fixture, [{ queryId: 'payments', retrievedIds: [] }, { queryId: 'payments', retrievedIds: [] }]),
      /must not contain duplicate id payments/,
    );
    const result = evaluateGoldenFixture(
      fixture,
      [
        { queryId: 'payments', retrievedIds: ['incident-payment'] },
        { queryId: 'deploy', retrievedIds: ['runbook-deploy'] },
        { queryId: 'unknown', retrievedIds: ['x'] },
      ],
    );
    assert.equal(result.gate.passed, false);
    assert.deepEqual(result.unexpectedQueryIds, ['unknown']);
    const permissive = evaluateGoldenFixture(
      fixture,
      [
        { queryId: 'payments', retrievedIds: ['incident-payment'] },
        { queryId: 'deploy', retrievedIds: ['runbook-deploy'] },
        { queryId: 'unknown', retrievedIds: ['x'] },
      ],
      { rejectUnexpectedResults: false },
    );
    assert.equal(permissive.gate.passed, true);
  });

  it('validates fixture and threshold inputs before producing a report', () => {
    assert.throws(() => parseGoldenFixture('{"version":1,"name":"bad","k":0,"queries":[]}'), /positive integer/);
    assert.throws(
      () => evaluateGoldenFixture(fixture, [], { thresholds: { minCoverage: 2 } }),
      /ratio between 0 and 1/,
    );
    assert.throws(
      () => evaluateGoldenFixture(fixture, [{ queryId: 'payments', retrievedIds: [], latencyMs: -1 }]),
      /finite and non-negative/,
    );
  });
});
