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
  | 'semantic'
  | 'like'
  | 'graph';

export interface Reason {
  channel: Channel;
  detail: string;
  base: number;
  /** Semantic provenance is additive and only present for semantic candidates. */
  similarity?: number;
  chunk_id?: string;
  heading?: string | null;
  model_revision?: string;
  parent_card?: string;
}

export interface ScoreFactors {
  type_weight: number;
  recency: number;
  staleness: number;
  status: number;
  /** Confidence boost/penalty factor (1.0 = no confidence data, >1.0 = high, <1.0 = low). */
  confidence: number;
  /** Superseded penalty factor (1.0 = not superseded, <1.0 = superseded). */
  superseded: number;
}

export interface ScoredCandidate {
  card: CardRow;
  base: number;
  reasons: Reason[];
  graph_distance: number;
  /** set by graph expansion */
  edge_type?: string;
  from_card?: string;
  /** Internal contextual evidence used by reranking; never emitted directly. */
  rerank_text?: string;
  /** A real edge discovered while expanding a lexical or semantic seed. */
  graph_evidence?: GraphEvidence;
}

export interface GraphEvidence {
  seed_card_id: string;
  edge_type: string;
  distance: number;
  seed_evidence: 'lexical' | 'semantic';
}

export interface ScoredResult extends ScoredCandidate {
  score: number;
  factors: ScoreFactors;
  stale: boolean;
  rerank?: import('./rerank').RerankExplanation;
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
  semantic: 0.86, // may outrank fuzzy lexical hits; exact/title/path remain rank-authoritative
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

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const HIGH_CONFIDENCE_BOOST = 1.15;
const LOW_CONFIDENCE_PENALTY = 0.85;
const SUPERSEDED_PENALTY_FACTOR = 0.7;

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
  if ((card as any).superseded_by) {
    stale = true;
  }
  return { penalty, stale };
}

export function statusFactor(status: string | null): number {
  if (!status) return 1.0;
  return STATUS_FACTORS[status.toLowerCase()] ?? 1.0;
}

export function confidenceFactor(confidence: number | null | undefined): number {
  if (confidence == null) return 1.0;
  if (confidence > HIGH_CONFIDENCE_THRESHOLD) return HIGH_CONFIDENCE_BOOST;
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return LOW_CONFIDENCE_PENALTY;
  return 1.0;
}

export function supersededFactor(supersededBy: string | string[] | null | undefined): number {
  if (!supersededBy) return 1.0;
  if (Array.isArray(supersededBy) && supersededBy.length === 0) return 1.0;
  return SUPERSEDED_PENALTY_FACTOR;
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
      if (cand.rerank_text?.trim()) {
        if (!existing.rerank_text?.trim()) {
          existing.rerank_text = cand.rerank_text;
        } else if (existing.rerank_text !== cand.rerank_text && !existing.rerank_text.includes(cand.rerank_text)) {
          existing.rerank_text = `${existing.rerank_text}\n${cand.rerank_text}`;
        }
      }
      if (cand.base > existing.base) {
        existing.base = cand.base;
        existing.graph_distance = cand.graph_distance;
        existing.edge_type = cand.edge_type;
        existing.from_card = cand.from_card;
        existing.graph_evidence = preferGraphEvidence(existing.graph_evidence, cand.graph_evidence);
      } else if (cand.graph_distance < existing.graph_distance) {
        existing.graph_distance = cand.graph_distance;
      }
      existing.graph_evidence = preferGraphEvidence(existing.graph_evidence, cand.graph_evidence);
    }
  }

  const results: ScoredResult[] = [];
  for (const cand of byId.values()) {
    const tw = typeWeight(cand.card.type, opts.typeWeights);
    const rf = recencyFactor(cand.card.updated_at, opts.now);
    const { penalty, stale } = stalenessPenalty(cand.card, opts.dirtyCardIds);
    const sf = statusFactor(cand.card.status);
    const cf = confidenceFactor((cand.card as any).confidence);
    const supf = supersededFactor((cand.card as any).superseded_by);
    results.push({
      ...cand,
      score: round4(cand.base * tw * rf * penalty * sf * cf * supf),
      factors: {
        type_weight: tw, recency: round4(rf), staleness: round4(penalty), status: sf,
        confidence: round4(cf), superseded: round4(supf),
      },
      stale,
    });
  }

  results.sort((a, b) => {
    const aExactId = a.reasons.some(r => r.channel === 'exact_id') ? 1 : 0;
    const bExactId = b.reasons.some(r => r.channel === 'exact_id') ? 1 : 0;
    if (aExactId !== bExactId) return bExactId - aExactId;

    // Semantic similarity may discover candidates, but must never displace an
    // exact title/path hit. Keep all pre-v1.1 deterministic channels otherwise
    // ordered by their established fused score.
    const exactAgainstSemantic = (result: ScoredResult, other: ScoredResult): number => {
      const exact = result.reasons.some(r => r.channel === 'exact_title' || r.channel === 'source_file');
      const otherSemanticOnly = other.reasons.some(r => r.channel === 'semantic')
        && !other.reasons.some(r => r.channel === 'exact_title' || r.channel === 'source_file');
      return exact && otherSemanticOnly ? 1 : 0;
    };
    const aAuthority = exactAgainstSemantic(a, b);
    const bAuthority = exactAgainstSemantic(b, a);
    return (bAuthority - aAuthority) || (b.score - a.score) || a.card.id.localeCompare(b.card.id);
  });
  return results;
}

function preferGraphEvidence(current: GraphEvidence | undefined, next: GraphEvidence | undefined): GraphEvidence | undefined {
  if (!current) return next;
  if (!next) return current;
  if (current.seed_evidence !== next.seed_evidence) {
    return current.seed_evidence === 'lexical' ? current : next;
  }
  return next.distance < current.distance ? next : current;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
