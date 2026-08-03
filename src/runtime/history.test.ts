import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryDiff, buildMemoryHistory } from './history';
import type { MemoryEvent } from './model';

function event(id: string, payload: Record<string, unknown>, at: string): MemoryEvent {
  return {
    id,
    type: 'commit',
    scope: 'project',
    occurred_at: at,
    recorded_at: at,
    payload,
    record_id: 'memory.database',
  };
}

test('Memory history is deterministic and exposes only event-carried diffs', () => {
  const result = buildMemoryHistory('memory.database', [
    event('e2', { summary: 'postgres', changes: [{ path: 'content.database', before: 'mysql', after: 'postgres' }] }, '2026-08-03T11:00:00.000Z'),
    event('e1', { summary: 'mysql' }, '2026-08-03T10:00:00.000Z'),
  ]);
  assert.deepEqual(result.entries.map(entry => entry.eventId), ['e1', 'e2']);
  assert.equal(result.entries[0]?.diffStatus, 'unavailable');
  assert.equal(result.entries[1]?.diffStatus, 'available');
  assert.deepEqual(result.entries[1]?.changes, [{ path: 'content.database', before: 'mysql', after: 'postgres' }]);
  assert.ok(result.warnings?.length);
});

test('Memory history matches legacy target_id payloads and respects a bounded window', () => {
  const result = buildMemoryHistory('memory.database', [
    { ...event('e3', { target_id: 'memory.database' }, '2026-08-03T12:00:00.000Z'), record_id: undefined },
    event('e1', { target_id: 'memory.other' }, '2026-08-03T10:00:00.000Z'),
  ], { from: '2026-08-03T11:00:00.000Z', limit: 1 });
  assert.deepEqual(result.entries.map(entry => entry.eventId), ['e3']);
});

test('Memory diff is deliberately limited to T-1 and T', () => {
  const result = buildMemoryDiff('memory.database', [
    event('e1', { summary: 'mysql' }, '2026-08-03T10:00:00.000Z'),
    event('e2', { changes: [{ path: 'database', before: 'mysql', after: 'postgres' }] }, '2026-08-03T11:00:00.000Z'),
    event('e3', { changes: [{ path: 'database', before: 'postgres', after: 'sqlite' }] }, '2026-08-03T12:00:00.000Z'),
  ]);
  assert.equal(result.previous?.eventId, 'e2');
  assert.equal(result.current?.eventId, 'e3');
  assert.deepEqual(result.changes, [{ path: 'database', before: 'postgres', after: 'sqlite' }]);
});

test('Memory diff defensively selects the latest two states from a long target history', () => {
  const events = Array.from({ length: 150 }, (_, index) => event(
    `e${index + 1}`,
    { changes: [{ path: 'value', before: index, after: index + 1 }] },
    `2026-08-03T${String(Math.floor(index / 60) + 1).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
  ));
  const result = buildMemoryDiff('memory.database', events);
  assert.equal(result.previous?.eventId, 'e149');
  assert.equal(result.current?.eventId, 'e150');
  assert.deepEqual(result.changes, [{ path: 'value', before: 149, after: 150 }]);
});
