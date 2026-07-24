import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSemanticEligibility } from './semantic';
import type { SemanticCardDocument } from '../semantic';

function card(id: string, overrides: Partial<SemanticCardDocument> = {}): SemanticCardDocument {
  return {
    id,
    title: id,
    body: 'body',
    frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
    ...overrides,
  };
}

describe('semantic health eligibility', () => {
  it('reports eligible cards and every safety exclusion reason without exposing content', () => {
    const result = summarizeSemanticEligibility([
      card('decision.safe'),
      card('decision.secret', { frontmatter: { trust_label: 'user_confirmed', sensitivity: 'secret' } }),
      card('decision.untrusted', { frontmatter: { trust_label: 'agent_generated', sensitivity: 'internal' } }),
      card('decision.candidate', { isCandidate: true }),
      card('decision.deleted', { isDeleted: true }),
      card('decision.superseded', { frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal', superseded_by: ['decision.next'] } }),
    ]);
    assert.deepEqual(result, {
      eligible_cards: 1,
      excluded_cards: 5,
      excluded_by_reason: { secret: 1, untrusted: 1, candidate: 1, deleted: 1, superseded: 1 },
    });
    assert.equal(JSON.stringify(result).includes('body'), false);
  });
});
