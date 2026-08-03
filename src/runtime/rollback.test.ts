import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRollbackCheckpoint,
  restoreRollbackCheckpoint,
  validateRollbackCheckpoint,
  type RollbackCheckpointInput,
} from './rollback';
import type { RepairChange } from './repair';

const changes: RepairChange[] = [
  { id: 'card.b', action: 'update_frontmatter', reason: 'refresh b', before: { value: 'old' }, after: { value: 'new' } },
  { id: 'card.a', action: 'update_frontmatter', reason: 'refresh a', before: null, after: { classification: 'decision' } },
];

const input: RollbackCheckpointInput = {
  id: 'checkpoint-1',
  planVersion: 1,
  createdAt: '2026-08-03T12:00:00-04:00',
  changes,
  reversible: true,
  source: 'verify --fix --only metadata',
};

describe('runtime rollback checkpoint protocol', () => {
  it('creates a validated serializable checkpoint with stable change order', () => {
    const checkpoint = createRollbackCheckpoint(input);
    assert.equal(checkpoint.version, 1);
    assert.equal(checkpoint.createdAt, '2026-08-03T16:00:00.000Z');
    assert.deepEqual(checkpoint.changes.map(change => change.id), ['card.a', 'card.b']);
    assert.deepEqual(validateRollbackCheckpoint(checkpoint), checkpoint);
  });

  it('restores by swapping before/after through an injected writer', () => {
    const checkpoint = createRollbackCheckpoint(input);
    const writes: RepairChange[] = [];
    const result = restoreRollbackCheckpoint(checkpoint, change => writes.push(change));
    assert.equal(result.status, 'restored');
    assert.deepEqual(result.restoredIds, ['card.a', 'card.b']);
    assert.equal(writes[0]?.action, 'rollback:update_frontmatter');
    assert.deepEqual(writes[0]?.before, { classification: 'decision' });
    assert.equal(writes[0]?.after, null);
  });

  it('does not write non-reversible checkpoints and fails closed on writer errors', () => {
    const irreversible = createRollbackCheckpoint({ ...input, reversible: false });
    let called = false;
    const skipped = restoreRollbackCheckpoint(irreversible, () => { called = true; });
    assert.equal(called, false);
    assert.equal(skipped.status, 'not-reversible');
    assert.deepEqual(skipped.skippedIds, ['card.a', 'card.b']);

    const failed = restoreRollbackCheckpoint(createRollbackCheckpoint(input), change => {
      if (change.id === 'card.a') throw new Error('writer unavailable');
    });
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.failures, [{ id: 'card.a', message: 'writer unavailable' }]);
    assert.deepEqual(failed.skippedIds, ['card.b']);
  });

  it('rejects malformed checkpoint metadata and repair snapshots', () => {
    assert.throws(() => createRollbackCheckpoint({ ...input, planVersion: 0 }), /positive integer/);
    assert.throws(() => createRollbackCheckpoint({ ...input, createdAt: 'not-a-date' }), /valid ISO date/);
    assert.throws(() => createRollbackCheckpoint({ ...input, changes: [{ ...changes[0]!, id: '' }] }), /invalid id/);
    assert.throws(() => createRollbackCheckpoint({ ...input, source: '' }), /non-empty string/);
  });
});
