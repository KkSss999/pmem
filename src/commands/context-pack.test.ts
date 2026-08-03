import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { packContext } from '../context-pack';
import { renderContextPack } from './context-pack';

describe('context-pack CLI surface', () => {
  it('renders the deterministic text representation by default', () => {
    const pack = packContext({
      query: 'deployment rollback',
      records: [{ id: 'decision.rollback', content: 'Use the previous release.' }],
    });
    assert.equal(renderContextPack(pack), pack.text);
    assert.match(renderContextPack(pack), /Query: deployment rollback/);
  });

  it('renders the complete wire shape as JSON for agents', () => {
    const pack = packContext({
      query: 'deployment rollback',
      records: [{ id: 'decision.rollback', content: 'Use the previous release.' }],
    });
    const parsed = JSON.parse(renderContextPack(pack, 'json'));
    assert.equal(parsed.schemaVersion, '1');
    assert.equal(parsed.contract.id, 'pmem.context-pack');
    assert.equal(parsed.contract.unknownFields, 'ignore');
    assert.equal(parsed.query, 'deployment rollback');
    assert.equal(parsed.records[0].id, 'decision.rollback');
    assert.equal(parsed.budget.usedTokens > 0, true);
  });
});
