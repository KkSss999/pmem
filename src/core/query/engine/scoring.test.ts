import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { CardRow } from '../../../types';
import { fuseAndScore, ftsBase, graphBase, recencyFactor, confidenceFactor, supersededFactor } from './scoring';

function card(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 'decision.alpha',
    type: 'decision',
    title: 'Alpha Decision',
    status: 'active',
    priority: null,
    file_path: '.pmem/decisions/decision.alpha.md',
    summary: null,
    schema_version: null,
    card_version: 1,
    created_at: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    last_verified_at: '2026-01-02T00:00:00.000Z',
    file_hash: 'f',
    frontmatter_hash: 'fm',
    body_hash: 'b',
    token_count: 10,
    section_count: 1,
    is_deleted: 0,
    is_candidate: 0,
    ...overrides,
  };
}

describe('v0.8 scoring', () => {
  it('normalizes bm25 into capped base score', () => {
    assert.strictEqual(ftsBase(-10, -10, -1), 0.8);
    assert.strictEqual(ftsBase(-1, -10, -1), 0.3);
  });

  it('applies graph hop decay', () => {
    assert.strictEqual(graphBase(0.8, 1, 1), 0.4);
    assert.strictEqual(graphBase(0.8, 0.5, 2), 0.1);
  });

  it('fuses duplicate candidates, merges reasons, and sorts deterministically', () => {
    const a = card();
    const b = card({ id: 'module.beta', type: 'module', title: 'Beta Module' });
    const results = fuseAndScore([
      { card: a, base: 0.7, graph_distance: 0, reasons: [{ channel: 'tag', detail: 'tag: x', base: 0.7 }] },
      { card: a, base: 0.9, graph_distance: 0, reasons: [{ channel: 'alias', detail: 'alias: x', base: 0.9 }] },
      { card: b, base: 0.9, graph_distance: 0, reasons: [{ channel: 'source_file', detail: 'source file', base: 0.9 }] },
    ], { now: Date.parse('2026-01-03T00:00:00.000Z'), dirtyCardIds: new Set() });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].card.id, 'decision.alpha');
    assert.strictEqual(results[0].reasons.length, 2);
    assert.ok(results[0].score > 0.9, 'decision/module type weight and recency should boost exact-ish hits');
  });

  it('preserves semantic rerank text when a deterministic channel found the card first', () => {
    const shared = card({ id: 'module.shared', type: 'module' });
    const results = fuseAndScore([
      { card: shared, base: 0.8, graph_distance: 0, reasons: [{ channel: 'fts', detail: 'bm25', base: 0.8 }] },
      {
        card: shared,
        base: 0.7,
        graph_distance: 0,
        reasons: [{ channel: 'semantic', detail: 'semantic passage', base: 0.7 }],
        rerank_text: 'credential rotation boundary\nContext: authentication session',
      },
    ], { now: Date.parse('2026-01-03T00:00:00.000Z'), dirtyCardIds: new Set() });

    assert.equal(results.length, 1);
    assert.equal(results[0].rerank_text, 'credential rotation boundary\nContext: authentication session');
    assert.deepEqual(results[0].reasons.map(reason => reason.channel), ['fts', 'semantic']);
  });

  it('penalizes dirty cards without hiding them', () => {
    const results = fuseAndScore([
      { card: card(), base: 1, graph_distance: 0, reasons: [{ channel: 'exact_id', detail: 'id', base: 1 }] },
    ], { now: Date.parse('2026-01-03T00:00:00.000Z'), dirtyCardIds: new Set(['decision.alpha']) });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].stale, true);
    assert.strictEqual(results[0].factors.staleness, 0.8);
  });

  it('keeps recency factor within expected bounds', () => {
    const factor = recencyFactor('2026-01-01T00:00:00.000Z', Date.parse('2026-04-01T00:00:00.000Z'));
    assert.ok(factor >= 0.75 && factor <= 1);
  });

  it('keeps exact id hits ahead of newer fuzzy hits', () => {
    const oldDirtyExact = card({
      id: 'decision.exact',
      updated_at: '2025-01-01T00:00:00.000Z',
      last_verified_at: '2024-01-01T00:00:00.000Z',
    });
    const freshFts = card({
      id: 'trace.fresh',
      type: 'trace',
      title: 'Fresh Trace',
      updated_at: '2026-01-03T00:00:00.000Z',
      last_verified_at: '2026-01-03T00:00:00.000Z',
    });
    const results = fuseAndScore([
      { card: freshFts, base: 0.8, graph_distance: 0, reasons: [{ channel: 'fts', detail: 'bm25', base: 0.8 }] },
      { card: oldDirtyExact, base: 1, graph_distance: 0, reasons: [{ channel: 'exact_id', detail: 'id', base: 1 }] },
    ], { now: Date.parse('2026-01-03T00:00:00.000Z'), dirtyCardIds: new Set(['decision.exact']) });
    assert.strictEqual(results[0].card.id, 'decision.exact');
  });

  it('keeps exact title and path hits ahead of semantic candidates', () => {
    const exactTitle = card({ id: 'decision.title', title: 'Target title', updated_at: '2024-01-01T00:00:00.000Z' });
    const exactPath = card({ id: 'module.path', type: 'module', updated_at: '2024-01-01T00:00:00.000Z' });
    const semantic = card({ id: 'decision.semantic', updated_at: '2026-01-03T00:00:00.000Z' });
    const results = fuseAndScore([
      { card: semantic, base: 0.99, graph_distance: 0, reasons: [{ channel: 'semantic', detail: 'similar', base: 0.99 }] },
      { card: exactTitle, base: 0.4, graph_distance: 0, reasons: [{ channel: 'exact_title', detail: 'title', base: 0.4 }] },
      { card: exactPath, base: 0.4, graph_distance: 0, reasons: [{ channel: 'source_file', detail: 'path', base: 0.4 }] },
    ], { now: Date.parse('2026-01-03T00:00:00.000Z'), dirtyCardIds: new Set() });
    assert.deepStrictEqual(results.slice(0, 2).map(result => result.card.id).sort(), ['decision.title', 'module.path']);
    assert.strictEqual(results[2].card.id, 'decision.semantic');
  });
});

describe('v1.1 agent-trust scoring factors', () => {
  it('confidenceFactor boosts high and penalizes low confidence', () => {
    assert.strictEqual(confidenceFactor(null), 1.0);
    assert.strictEqual(confidenceFactor(undefined), 1.0);
    assert.ok(confidenceFactor(0.95) > 1.0, 'high confidence should boost');
    assert.ok(confidenceFactor(0.1) < 1.0, 'low confidence should penalize');
  });

  it('supersededFactor penalizes superseded cards', () => {
    assert.strictEqual(supersededFactor(null), 1.0);
    assert.strictEqual(supersededFactor([]), 1.0);
    assert.ok(supersededFactor(['decision.new']) < 1.0, 'array supersede penalizes');
    // stored form is a JSON string; any non-empty string is treated as superseded
    assert.ok(supersededFactor('["decision.new"]') < 1.0, 'string supersede penalizes');
  });

  it('fuseAndScore applies confidence and superseded factors from card fields', () => {
    const lowConf = card({ id: 'decision.low', confidence: 0.1 } as any);
    const superseded = card({ id: 'decision.sup', superseded_by: '["decision.low"]' } as any);
    const baseline = card({ id: 'decision.base' });
    const now = Date.parse('2026-01-02T00:00:00.000Z');
    const results = fuseAndScore([
      { card: lowConf, base: 1, graph_distance: 0, reasons: [{ channel: 'like', detail: 'x', base: 1 }] },
      { card: superseded, base: 1, graph_distance: 0, reasons: [{ channel: 'like', detail: 'x', base: 1 }] },
      { card: baseline, base: 1, graph_distance: 0, reasons: [{ channel: 'like', detail: 'x', base: 1 }] },
    ], { now, dirtyCardIds: new Set() });
    const byId = Object.fromEntries(results.map(r => [r.card.id, r]));
    assert.ok(byId['decision.low'].factors.confidence < 1.0, 'low confidence factor applied');
    assert.ok(byId['decision.sup'].factors.superseded < 1.0, 'superseded factor applied');
    assert.strictEqual(byId['decision.base'].factors.confidence, 1.0);
    assert.strictEqual(byId['decision.base'].factors.superseded, 1.0);
    // baseline should outrank both penalized cards
    assert.ok(byId['decision.base'].score > byId['decision.low'].score);
    assert.ok(byId['decision.base'].score > byId['decision.sup'].score);
  });
});
