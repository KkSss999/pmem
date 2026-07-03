import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { CardRow } from '../../../types';
import { fuseAndScore, ftsBase, graphBase, recencyFactor } from './scoring';

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
});
