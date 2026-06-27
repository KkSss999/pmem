/**
 * v0.7.6 fix U2: Unit tests for `buildSuggestMessage`.
 *
 * GitHub Issue #10: `pmem update --suggest` previously reported
 * `"Memory is up to date."` for THREE distinct empty states, leaving agents
 * unable to distinguish:
 *   1. Genuine empty project (zero cards)
 *   2. Cards exist but no dirty flags (may genuinely be up to date)
 *   3. Cards exist, change graph produced zero affected cards
 *
 * `buildSuggestMessage` now returns `{ message, state }` where `state` is
 * one of `'no_cards' | 'no_affected_cards' | 'has_suggestions'`.
 *
 * These tests cover the three core state branches. They run in-process via
 * ts-node/register (no DB / filesystem fixtures required).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildSuggestMessage } from './update';
import type { SuggestSummary } from '../types';

function makeSummary(overrides: Partial<SuggestSummary> = {}): SuggestSummary {
  return {
    affected_cards: 0,
    blocking: 0,
    warning: 0,
    info: 0,
    duplicates_hidden: 0,
    historical_hidden: 0,
    verify_blocking: false,
    ...overrides,
  };
}

describe('buildSuggestMessage — v0.7.6 fix U2: state machine', () => {
  it('returns state="no_cards" when cardCount is 0 (even with non-zero summary)', () => {
    // Edge case: cardCount=0 should ALWAYS win, even if summary counters
    // happen to be non-zero (defensive — shouldn't happen in practice but
    // pin the precedence).
    const result = buildSuggestMessage(makeSummary({ blocking: 2, warning: 1 }), 0);
    assert.strictEqual(result.state, 'no_cards');
    assert.ok(
      result.message.includes('No memory cards exist'),
      `Expected bootstrap hint, got: ${result.message}`,
    );
    assert.ok(
      result.message.includes('pmem new') || result.message.includes('pmem init'),
      `Expected actionable next-step, got: ${result.message}`,
    );
  });

  it('returns state="no_affected_cards" when cardCount > 0 but all counters are zero', () => {
    const result = buildSuggestMessage(makeSummary(), 5);
    assert.strictEqual(result.state, 'no_affected_cards');
    assert.ok(
      result.message.includes('No suggestions generated'),
      `Expected "no suggestions generated" wording, got: ${result.message}`,
    );
    assert.ok(
      result.message.includes('pmem status'),
      `Expected suggestion to run pmem status, got: ${result.message}`,
    );
    assert.ok(
      result.message.includes('pmem verify'),
      `Expected suggestion to run pmem verify, got: ${result.message}`,
    );
  });

  it('returns state="has_suggestions" when blocking > 0', () => {
    const result = buildSuggestMessage(makeSummary({ blocking: 1 }), 5);
    assert.strictEqual(result.state, 'has_suggestions');
    assert.ok(
      result.message.includes('1 blocking memory consistency issue'),
      `Expected blocking message, got: ${result.message}`,
    );
  });

  it('returns state="has_suggestions" when warning > 0', () => {
    const result = buildSuggestMessage(makeSummary({ warning: 3 }), 5);
    assert.strictEqual(result.state, 'has_suggestions');
    assert.ok(
      result.message.includes('3 current suggestion'),
      `Expected warning count in message, got: ${result.message}`,
    );
  });

  it('returns state="has_suggestions" when info > 0', () => {
    const result = buildSuggestMessage(makeSummary({ info: 7 }), 5);
    assert.strictEqual(result.state, 'has_suggestions');
    assert.ok(
      result.message.includes('7 informational item'),
      `Expected info count in message, got: ${result.message}`,
    );
  });

  it('returns state="has_suggestions" with all severities combined', () => {
    const result = buildSuggestMessage(makeSummary({ blocking: 2, warning: 3, info: 1 }), 10);
    assert.strictEqual(result.state, 'has_suggestions');
    assert.ok(result.message.includes('2 blocking'), `blocking missing: ${result.message}`);
    assert.ok(result.message.includes('3 current'), `warning missing: ${result.message}`);
    assert.ok(result.message.includes('1 informational'), `info missing: ${result.message}`);
    assert.ok(result.message.endsWith('.'), `expected terminal period: ${result.message}`);
  });

  it('cardCount=1 with zero summary still yields "no_affected_cards" (not "no_cards")', () => {
    // Boundary: exactly one card present, no suggestions. Must NOT collapse
    // into "no_cards" because bootstrap is not what the agent needs.
    const result = buildSuggestMessage(makeSummary(), 1);
    assert.strictEqual(result.state, 'no_affected_cards');
  });

  it('returns an object with both `message` and `state` keys', () => {
    const result = buildSuggestMessage(makeSummary(), 0);
    assert.ok(typeof result === 'object' && result !== null, 'expected object return');
    assert.ok('message' in result, 'expected `message` field');
    assert.ok('state' in result, 'expected `state` field');
    assert.strictEqual(typeof result.message, 'string');
    assert.ok(['no_cards', 'no_affected_cards', 'has_suggestions'].includes(result.state));
  });

  it('"no_affected_cards" message never claims memory is "up to date"', () => {
    // The whole point of U2 is that we no longer say "Memory is up to date"
    // for the "no affected cards" state, because that phrase is misleading
    // — the change graph may simply not have surfaced anything yet.
    const result = buildSuggestMessage(makeSummary(), 5);
    assert.ok(
      !/up to date/i.test(result.message),
      `U2 message must NOT say "up to date"; got: ${result.message}`,
    );
  });

  it('"has_suggestions" message is non-empty and ends with period', () => {
    const result = buildSuggestMessage(makeSummary({ blocking: 1 }), 5);
    assert.ok(result.message.length > 0, 'message must be non-empty');
    assert.ok(result.message.endsWith('.'), `expected terminal period: ${result.message}`);
  });
});