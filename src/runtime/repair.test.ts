import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRepairPlan, buildRepairPlan, type RepairChange } from './repair';

const changes: RepairChange[] = [
  { id: 'card.b', action: 'update_frontmatter', reason: 'refresh metadata', before: { value: 'old', nested: { z: 1, a: 2 } }, after: { value: 'new' } },
  { id: 'card.a', action: 'update_frontmatter', reason: 'refresh metadata', before: null, after: { classification: 'decision' } },
];

describe('runtime repair protocol', () => {
  it('builds a read-only deterministic dry-run plan sorted by id', () => {
    const input = structuredClone(changes);
    const plan = buildRepairPlan(input);
    assert.equal(plan.version, 1);
    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.apply, false);
    assert.deepEqual(plan.changes.map(change => change.id), ['card.a', 'card.b']);
    assert.deepEqual(plan.changes[1]?.before, { nested: { a: 2, z: 1 }, value: 'old' });
    assert.deepEqual(input, changes);
  });

  it('builds an explicit apply plan and reports successful execution', () => {
    const plan = buildRepairPlan(changes, { apply: true });
    const executed: string[] = [];
    const result = applyRepairPlan(plan, change => executed.push(change.id));
    assert.equal(plan.mode, 'apply');
    assert.deepEqual(executed, ['card.a', 'card.b']);
    assert.deepEqual(result, { status: 'applied', appliedIds: ['card.a', 'card.b'], skippedIds: [], failures: [] });
  });

  it('never executes a dry-run and fails closed after an executor error', () => {
    const dryRun = applyRepairPlan(buildRepairPlan(changes), () => { throw new Error('must not run'); });
    assert.equal(dryRun.status, 'dry-run');
    assert.deepEqual(dryRun.skippedIds, ['card.a', 'card.b']);

    const calls: string[] = [];
    const partial = applyRepairPlan(buildRepairPlan(changes, { apply: true }), change => {
      calls.push(change.id);
      if (change.id === 'card.a') throw new Error('writer unavailable');
    });
    assert.deepEqual(calls, ['card.a']);
    assert.equal(partial.status, 'failed');
    assert.deepEqual(partial.failures, [{ id: 'card.a', message: 'writer unavailable' }]);
    assert.deepEqual(partial.skippedIds, ['card.b']);
  });

  it('rejects duplicate ids, invalid snapshots, and conflicting modes', () => {
    assert.throws(() => buildRepairPlan([changes[0]!, changes[0]!]), /duplicate id card.b/);
    assert.throws(() => buildRepairPlan([{ ...changes[0]!, before: Number.NaN }]), /JSON-compatible/);
    assert.throws(() => buildRepairPlan(changes, { dryRun: true, apply: true }), /both dry-run and apply/);
  });
});
