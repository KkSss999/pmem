import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSemanticEvidence,
  createSemanticEvidence,
  isSemanticEvidence,
  semanticEvidenceIssues,
  sortSemanticEvidence,
  validateSemanticEvidence,
  type SemanticEvidence,
} from './evidence';

function evidence(overrides: Partial<Parameters<typeof createSemanticEvidence>[0]> = {}): SemanticEvidence {
  return createSemanticEvidence({
    provenance: { model: 'multilingual-e5-small', revision: 'r1', dimension: 384, chunkStrategy: 'heading-aware-v1' },
    chunkId: 'card-a#0',
    heading: 'Overview',
    headingPath: ['Overview'],
    similarity: 0.82,
    parentRecord: { id: 'card-a', type: 'decision', title: 'A' },
    ...overrides,
  });
}

test('constructs serializable supporting evidence with complete provenance', () => {
  const value = evidence({ parentRecordId: 'card-a', parentRecord: undefined });
  assert.equal(value.authority, 'supporting');
  assert.equal(value.provenance.dimension, 384);
  assert.equal(value.chunkId, 'card-a#0');
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  assert.equal(isSemanticEvidence(value), true);
});

test('records deterministic fallback and degradation without promoting semantic authority', () => {
  const value = evidence({
    fallback: { strategy: 'deterministic', reason: 'index_stale' },
    degradationReason: 'index_stale',
  });
  assert.equal(value.authority, 'supporting');
  assert.deepEqual(value.fallback, { strategy: 'deterministic', reason: 'index_stale' });
  assert.equal(value.degradationReason, 'index_stale');
});

test('validates malformed serialized evidence', () => {
  const value = evidence();
  const malformed = { ...value, similarity: 2, authority: 'authoritative' };
  const issues = semanticEvidenceIssues(malformed);
  assert.equal(validateSemanticEvidence(malformed).valid, false);
  assert.equal(isSemanticEvidence(malformed), false);
  assert.ok(issues.some(issue => issue.includes('similarity')));
  assert.ok(issues.some(issue => issue.includes('authority')));
  assert.throws(() => assertSemanticEvidence(malformed), /Invalid semantic evidence/);
});

test('sorts by similarity then stable parent/chunk identity without mutating input', () => {
  const low = evidence({ chunkId: 'z#0', parentRecord: 'card-z', similarity: 0.4 });
  const tieZ = evidence({ chunkId: 'z#1', parentRecord: 'card-a', similarity: 0.8 });
  const tieA = evidence({ chunkId: 'a#0', parentRecord: 'card-a', similarity: 0.8 });
  const input = [low, tieZ, tieA];
  const sorted = sortSemanticEvidence(input);
  assert.deepEqual(sorted.map(value => value.chunkId), ['a#0', 'z#1', 'z#0']);
  assert.deepEqual(input.map(value => value.chunkId), ['z#0', 'z#1', 'a#0']);
  assert.notStrictEqual(sorted[0], tieA);
});
