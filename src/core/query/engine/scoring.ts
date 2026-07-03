import type { CardRow } from '../../../types';

export type Channel =
  | 'exact_id'
  | 'id_substring'
  | 'exact_title'
  | 'title_phrase'
  | 'title_token'
  | 'alias'
  | 'tag'
  | 'tag_token'
  | 'source_file'
  | 'source_file_prefix'
  | 'fts'
  | 'like'
  | 'graph';

export interface Reason {
  channel: Channel;
  detail: string;
  base: number;
}

export interface ScoreFactors {
  type_weight: number;
  recency: number;
  staleness: number;
  status: number;
}

export interface ScoredCandidate {
  card: CardRow;
  base: number;
  reasons: Reason[];
  graph_distance: number;
  /** set by graph expansion */
  edge_type?: string;
  from_card?: string;
}

export interface ScoredResult extends ScoredCandidate {
  score: number;
  factors: ScoreFactors;
  stale: boolean;
}

export const CHANNEL_BASE: Record<Channel, number> = {
  exact_id: 1.0,
  exact_title: 0.92,
  title_phrase: 0.88,
  title_token: 0.78,
  id_substring: 0.85,
  alias: 0.9,
  tag: 0.7,
  tag_token: 0.6,
  source_file: 0.9,
  source_file_prefix: 0.75,
  fts: 0.8, // upper cap; actual base computed from bm25
  like: 0.5,
  graph: 0.6, // fallback; actual base inherited from seed
};

export const DEFAULT_TYPE_WEIGHTS: Record<string, number> = {
  decision: 1.1,
  module: 1.1,
  trace: 0.85,
};

const GRAPH_HOP_DECAY = 0.5;
const RECENCY_FLOOR = 0.75;
const RECENCY_HALF_LIFE_DAYS = 90;
const DIRTY_PENALTY = 0.8;
const UNVERIFIED_PENALTY = 0.9;

const STATUS_FACTORS: Record<string, number> = {
  superseded: 0.5,
  archived: 0.5,
  deprecated: 0.3,
  done: 0.8,
  completed: 0.8,
};

/** Normalize a raw bm25 rank (lower = better, typically negative) to a base in [0.3, 0.8]. */
export function ftsBase(rank: number, bestRank: number, worstRank: number): number {
  if (worstRank === bestRank) return 0.8;
  const norm = (worstRank - rank) / (worstRank - bestRank); // 1 = best
  return 0.3 + 0.5 * Math.max(0, Math.min(1, norm));
}

export function graphBase(seedScore: number, edgeConfidence: number, hops: number): number {
  return seedScore * edgeConfidence * Math.pow(GRAPH_HOP_DECAY, hops);
}

export function recencyFactor(updatedAt: string | null, now: number): number {
  if (!updatedAt) return RECENCY_FLOOR;
  const updated = Date.parse(updatedAt);
  if (isNaN(updated)) return RECENCY_FLOOR;
  const ageDays = Math.max(0, (now - updated) / 86400000);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function stalenessPenalty(card: CardRow, dirtyCardIds: Set<string>): { penalty: number; stale: boolean } {
  let penalty = 1.0;
  let stale = false;
  if (dirtyCardIds.has(card.id)) {
    penalty *= DIRTY_PENALTY;
    stale = true;
  }
  if (card.last_verified_at && card.updated_at && card.last_verified_at < card.updated_at) {
    penalty *= UNVERIFIED_PENALTY;
    stale = true;
  }
  return { penalty, stale };
}

export function statusFactor(status: string | null): number {
  if (!status) return 1.0;
  return STATUS_FACTORS[status.toLowerCase()] ?? 1.0;
}

export function typeWeight(type: string, overrides?: Record<string, number>): number {
  if (overrides && overrides[type] !== undefined) return overrides[type];
  return DEFAULT_TYPE_WEIGHTS[type] ?? 1.0;
}

export interface ScoringOptions {
  now: number;
  dirtyCardIds: Set<string>;
  typeWeights?: Record<string, number>;
}

/**
 * Fuse candidates from all channels: dedupe by card id keeping the highest
 * base, merge reasons, apply multiplicative factors, sort deterministically.
 */
export function fuseAndScore(candidates: ScoredCandidate[], opts: ScoringOptions): ScoredResult[] {
  const byId = new Map<string, ScoredCandidate>();

  for (const cand of candidates) {
    const existing = byId.get(cand.card.id);
    if (!existing) {
      byId.set(cand.card.id, { ...cand, reasons: [...cand.reasons] });
    } else {
      existing.reasons.push(...cand.reasons);
      if (cand.base > existing.base) {
        existing.base = cand.base;
        existing.graph_distance = cand.graph_distance;
        existing.edge_type = cand.edge_type;
        existing.from_card = cand.from_card;
      } else if (cand.graph_distance < existing.graph_distance) {
        existing.graph_distance = cand.graph_distance;
      }
    }
  }

  const results: ScoredResult[] = [];
  for (const cand of byId.values()) {
    const tw = typeWeight(cand.card.type, opts.typeWeights);
    const rf = recencyFactor(cand.card.updated_at, opts.now);
    const { penalty, stale } = stalenessPenalty(cand.card, opts.dirtyCardIds);
    const sf = statusFactor(cand.card.status);
    results.push({
      ...cand,
      score: round4(cand.base * tw * rf * penalty * sf),
      factors: { type_weight: tw, recency: round4(rf), staleness: round4(penalty), status: sf },
      stale,
    });
  }

  results.sort((a, b) => {
    const aExact = a.reasons.some(r => r.channel === 'exact_id') ? 1 : 0;
    const bExact = b.reasons.some(r => r.channel === 'exact_id') ? 1 : 0;
    return (bExact - aExact) || (b.score - a.score) || a.card.id.localeCompare(b.card.id);
  });
  return results;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
