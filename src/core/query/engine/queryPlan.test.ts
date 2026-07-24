import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from './intent';
import { buildQueryPlan } from './queryPlan';

describe('v1.2 deterministic query planning', () => {
  it('preserves raw multilingual input and extracts anchors without invented synonyms', () => {
    const intent = parseIntent('请排查 src/core/db.ts 的 SQLite regression', ['module', 'decision', 'trace', 'risk']);
    const plan = buildQueryPlan(intent);
    assert.equal(plan.raw, '请排查 src/core/db.ts 的 SQLite regression');
    assert.deepEqual(plan.exactAnchors, ['src/core/db.ts']);
    assert.ok(plan.preferredTypes.includes('trace'));
    assert.ok(plan.preferredTypes.includes('risk'));
    assert.ok(!plan.terms.includes('database'), 'query planning must not fabricate synonyms');
  });

  it('uses explicit type hints together with task intent', () => {
    const intent = parseIntent('decision 为什么要重构检索', ['module', 'decision', 'trace', 'risk']);
    const plan = buildQueryPlan(intent);
    assert.ok(plan.preferredTypes.includes('decision'));
    assert.ok(plan.preferredTypes.includes('module'));
  });
});
