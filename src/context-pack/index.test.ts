import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateContextTokens, packContext } from './index';

describe('ContextPack', () => {
  const base = {
    query: 'payment timeout recovery',
    records: [
      { id: 'zeta', title: 'Zeta', content: 'retry after timeout', score: 0.8, source: { path: 'z.md' } },
      { id: 'alpha', title: 'Alpha', content: 'backoff strategy', score: 0.8, source: { path: 'a.md' } },
    ],
    evidence: [{ id: 'e-z', recordId: 'zeta', kind: 'quote', content: 'retry is safe', score: 0.9 }],
    provenance: { model: { revision: 'b', name: 'local' }, retrievers: ['lexical', 'semantic'] },
  } as const;

  it('returns a JSON-safe stable wire shape', () => {
    const first = packContext(base, { budget: 500 });
    const second = packContext(base, { budget: 500 });
    assert.equal(first.schemaVersion, '1');
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(Object.keys(first.provenance), ['model', 'retrievers']);
  });

  it('orders records by score and then id for deterministic ties', () => {
    const result = packContext(base, { budget: 500 });
    assert.deepEqual(result.records.map(record => record.id), ['alpha', 'zeta']);
    assert.deepEqual(result.evidence.map(evidence => evidence.id), ['e-z']);
  });

  it('supports a token budget and reports omitted records/evidence', () => {
    const result = packContext({
      query: 'q',
      records: [
        { id: 'first', content: 'one '.repeat(80), score: 2 },
        { id: 'second', content: 'two '.repeat(80), score: 1 },
      ],
      evidence: [{ id: 'e2', recordId: 'second', content: 'evidence '.repeat(40) }],
    }, { budget: 12 });
    assert.ok(result.budget.usedTokens <= result.budget.requestedTokens);
    assert.equal(result.diagnostics.truncated, true);
    assert.ok(result.diagnostics.omittedRecordIds.includes('second') || result.diagnostics.omittedEvidenceIds.includes('e2'));
  });

  it('clips content when the item header fits but its body does not', () => {
    const result = packContext({ query: 'q', records: [{ id: 'r', content: 'word '.repeat(100) }] }, { budget: 12 });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].truncated, true);
    assert.ok(result.records[0].content.length < 500);
    assert.equal(result.diagnostics.truncated, true);
  });

  it('normalizes invalid, duplicate, and orphaned inputs with diagnostics', () => {
    const result = packContext({
      query: 'q',
      records: [
        { id: '', content: 'invalid' },
        { id: 'r', content: 'valid' },
        { id: 'r', content: 'duplicate' },
      ],
      evidence: [
        { id: 'orphan', recordId: 'missing', content: 'orphan' },
        { id: 'e', recordId: 'r', content: 'valid evidence' },
        { id: 'e', recordId: 'r', content: 'duplicate evidence' },
      ],
    }, { budget: 100 });
    assert.deepEqual(result.records.map(record => record.id), ['r']);
    assert.deepEqual(result.evidence.map(evidence => evidence.id), ['e']);
    assert.deepEqual(result.diagnostics.omittedRecordIds, ['record-1', 'r']);
    assert.deepEqual(result.diagnostics.omittedEvidenceIds, ['orphan', 'e']);
  });

  it('supports per-record evidence and evidence limits', () => {
    const result = packContext({
      query: 'q',
      records: [{
        id: 'r', content: 'record', evidence: [
          { recordId: 'r', content: 'first' },
          { recordId: 'r', content: 'second' },
        ],
      }],
    }, { budget: 100, maxEvidencePerRecord: 1 });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].id, 'r:e1');
    assert.equal(result.diagnostics.omittedEvidenceIds.length, 1);
  });

  it('does not mutate caller input', () => {
    const input = { ...base, records: [...base.records], evidence: [...base.evidence] };
    const before = JSON.stringify(input);
    packContext(input, { budget: 100 });
    assert.equal(JSON.stringify(input), before);
  });

  it('accepts input-level tokenBudget and handles zero budgets deterministically', () => {
    const zero = packContext({ query: 'hello', records: [], tokenBudget: 0 });
    assert.equal(zero.budget.requestedTokens, 0);
    assert.equal(zero.budget.usedTokens, 0);
    assert.equal(zero.query, '');
    assert.equal(zero.diagnostics.truncated, true);
    assert.ok(estimateContextTokens(zero.text) >= 0);
  });
});
