import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseIntent, tokenize } from './intent';

describe('v0.8 intent parsing', () => {
  it('detects file paths, card ids, type hints, and CJK tokens', () => {
    const intent = parseIntent('decision.foo_bar_20260101 src/core/db.ts 混合 recall decision', ['decision', 'module']);
    assert.deepStrictEqual(intent.cardIdCandidates, ['decision.foo_bar_20260101']);
    assert.deepStrictEqual(intent.pathCandidates, ['src/core/db.ts']);
    assert.deepStrictEqual(intent.typeHints, ['decision']);
    assert.ok(intent.tokens.includes('混'));
    assert.ok(intent.tokens.includes('recall'));
  });

  it('deduplicates tokens deterministically', () => {
    assert.deepStrictEqual(tokenize('recall recall, ask'), ['recall', 'ask']);
  });

  it('detects English inventory intent and canonicalizes plural card types', () => {
    const intent = parseIntent('list all characters', ['character', 'chapter']);
    assert.deepStrictEqual(intent.typeHints, ['character']);
    assert.strictEqual(intent.enumeration, true);
  });

  it('detects Chinese inventory intent and maps domain aliases', () => {
    const intent = parseIntent('有哪些角色', ['character', 'world']);
    assert.deepStrictEqual(intent.typeHints, ['character']);
    assert.strictEqual(intent.enumeration, true);
  });

  it('does not turn an ordinary type keyword into an inventory request', () => {
    const intent = parseIntent('character motivation', ['character']);
    assert.strictEqual(intent.enumeration, false);
  });
});
