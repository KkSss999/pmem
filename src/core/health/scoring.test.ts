import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { VerifyIssue } from '../../types';
import { aggregateHealthIssues, buildVerifyResult } from './scoring';

function issue(type: string, severity: VerifyIssue['severity'], cardId?: string): VerifyIssue {
  return { type, severity, card_id: cardId, message: type, fix: 'fix' };
}

describe('v1.2 health scoring', () => {
  it('keeps one-warning compatibility at 95', () => {
    const result = buildVerifyResult([issue('card_too_large', 'warning', 'task.large')], null, 'missing', '/tmp/baseline');
    assert.equal(result.score, 95);
    assert.equal(result.overall_score, 95);
    assert.equal(result.change_score, null);
    assert.equal(result.dimensions.metadata.score, 95);
    assert.equal(result.dimensions.semantic_readiness.status, 'not_applicable');
  });

  it('uses diminishing capped penalties for large historical debt', () => {
    const issues = Array.from({ length: 100 }, (_, index) => issue('stale_memory', 'warning', `module.${index}`));
    const result = buildVerifyResult(issues, null, 'missing', '/tmp/baseline');
    assert.equal(result.score, 80);
    assert.ok(result.score > 0);
  });

  it('collapses repeated evidence for the same card', () => {
    const raw = Array.from({ length: 10 }, (_, index) => ({
      ...issue('stale_memory', 'warning', 'module.core'),
      file_path: `src/${index}.ts`,
    }));
    const aggregated = aggregateHealthIssues(raw);
    assert.equal(aggregated.length, 1);
    assert.equal(aggregated[0].evidence_count, 10);
    assert.equal(aggregated[0].file_paths?.length, 10);
  });

  it('scores only issues newer or more severe than a loaded baseline', () => {
    const old = issue('stale_memory', 'warning', 'module.old');
    const oldAggregated = aggregateHealthIssues([old])[0];
    const baseline = {
      schema_version: 1 as const,
      created_at: new Date(0).toISOString(),
      project: 'fixture',
      entries: [{ fingerprint: oldAggregated.fingerprint!, severity: 'warning' as const, dimension: oldAggregated.dimension!, evidence_count: 1 }],
    };
    const result = buildVerifyResult([old, issue('card_too_large', 'warning', 'task.new')], baseline, 'loaded', '/tmp/baseline');
    assert.equal(result.change_score, 95);
    assert.equal(result.baseline.historical, 1);
    assert.equal(result.baseline.new, 1);
  });

  it('treats increased evidence for a global fingerprint as a regression', () => {
    const baseline = {
      schema_version: 1 as const,
      created_at: new Date(0).toISOString(),
      project: 'fixture',
      entries: [{ fingerprint: 'orphan_edges:global', severity: 'warning' as const, dimension: 'correctness' as const, evidence_count: 1 }],
    };
    const result = buildVerifyResult([
      { ...issue('orphan_edges', 'warning'), evidence_count: 100 },
    ], baseline, 'loaded', '/tmp/baseline');
    assert.equal(result.change_score, 95);
    assert.equal(result.baseline.historical, 0);
    assert.equal(result.baseline.new, 1);
  });

  it('keeps error pass/fail semantics', () => {
    const result = buildVerifyResult([issue('corrupt_database', 'error')], null, 'missing', '/tmp/baseline');
    assert.equal(result.passed, false);
    assert.equal(result.score, 70);
  });
});
