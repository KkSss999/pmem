import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_PACK_CAPABILITIES,
  CONTEXT_PACK_PROTOCOL_ID,
  CONTEXT_PACK_PROTOCOL_VERSION,
  CONTEXT_PACK_UNKNOWN_FIELDS,
  DEFAULT_MAX_EVIDENCE_PER_RECORD,
  contextPackContract,
  estimateContextTokens,
  isContextPack,
  isContextPackContract,
  packContext,
} from './index';

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
    assert.deepEqual(first.contract, {
      id: CONTEXT_PACK_PROTOCOL_ID,
      version: CONTEXT_PACK_PROTOCOL_VERSION,
      compatibility: 'additive',
      unknownFields: CONTEXT_PACK_UNKNOWN_FIELDS,
      capabilities: CONTEXT_PACK_CAPABILITIES,
    });
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(Object.keys(first.provenance), ['model', 'retrievers']);
  });

  it('accepts additive unknown fields and supplies the v1 contract for legacy payloads', () => {
    const pack = packContext({ query: 'q', records: [] });
    const withUnknown = { ...pack, futureField: { ignored: true } };
    assert.equal(isContextPack(withUnknown), true);
    assert.deepEqual(contextPackContract(withUnknown), pack.contract);

    const legacy = { ...pack };
    delete (legacy as { contract?: unknown }).contract;
    assert.equal(isContextPack(legacy), true);
    assert.deepEqual(contextPackContract(legacy), pack.contract);
  });

  it('rejects malformed known fields and incompatible contracts while ignoring additive fields', () => {
    const pack = packContext(base, { budget: 500 });
    assert.equal(isContextPack({ ...pack, futureField: true }), true);
    assert.equal(isContextPack({ ...pack, contract: { ...pack.contract, version: '2' } }), false);
    assert.equal(isContextPack({ ...pack, records: [{ id: 'r', content: 42 }] }), false);
    assert.equal(isContextPack({ ...pack, evidence: [{ id: 'e', recordId: 'r', content: 'ok', score: 'bad' }] }), false);
    assert.equal(isContextPackContract({ ...pack.contract, compatibility: 'breaking' }), false);
    assert.throws(() => contextPackContract({ contract: { ...pack.contract, version: '2' } } as never), /invalid ContextPack contract/i);
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

  it('applies a safe default evidence limit and reports an explicit count', () => {
    const result = packContext({
      query: 'q',
      records: [{
        id: 'r', content: 'record', evidence: Array.from({ length: DEFAULT_MAX_EVIDENCE_PER_RECORD + 1 }, (_, index) => ({
          recordId: 'r',
          id: `e${index + 1}`,
          content: `evidence ${index + 1}`,
        })),
      }],
    }, { budget: 500 });
    assert.equal(result.evidence.length, DEFAULT_MAX_EVIDENCE_PER_RECORD);
    assert.equal(result.diagnostics.omittedEvidenceCount, 1);
  });

  it('supports a target-model token estimator and keeps provenance in the wire/text contract', () => {
    const result = packContext({
      query: 'q',
      records: [{ id: 'r', content: 'record', metadata: { channel: 'semantic' } }],
      evidence: [{
        id: 'e',
        recordId: 'r',
        content: 'evidence',
        provenance: { model: 'test', revision: 'r1' },
      }],
      provenance: { executed: ['semantic'] },
    }, { budget: 500, tokenEstimator: { estimate: value => value.length } });
    assert.ok(result.text.includes('model'));
    assert.deepEqual(result.evidence[0]?.provenance, { model: 'test', revision: 'r1' });
    assert.ok(result.budget.usedTokens <= result.budget.requestedTokens);
  });

  it('uses deterministic MMR-style diversity ordering for similar records', () => {
    const result = packContext({
      query: 'payment timeout',
      records: [
        { id: 'a', content: 'payment timeout retry strategy', score: 1 },
        { id: 'b', content: 'payment timeout retry backoff', score: 0.99 },
        { id: 'c', content: 'deployment rollback checklist', score: 0.8 },
      ],
    }, { budget: 500, diversityLambda: 0.3 });
    assert.deepEqual(result.records.map(record => record.id), ['a', 'c', 'b']);
  });

  it('reserves part of a normal budget for provenance-bearing evidence', () => {
    const result = packContext({
      query: 'q',
      records: Array.from({ length: 10 }, (_, index) => ({ id: `r${index}`, content: 'record content '.repeat(8), score: 10 - index })),
      evidence: [{ id: 'e1', recordId: 'r0', content: 'semantic evidence', provenance: { model: 'test', revision: 'r1' } }],
    }, { budget: 200 });
    assert.ok(result.records.length > 0);
    assert.equal(result.evidence[0]?.id, 'e1');
    assert.ok(result.budget.usedTokens <= result.budget.requestedTokens);
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
