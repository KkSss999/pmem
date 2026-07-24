import type { QueryPlan } from './queryPlan';
import type { ScoredResult } from './scoring';

export const CONTEXTUAL_RERANK_VERSION = 'contextual-v1' as const;
export const DEFAULT_RERANK_CANDIDATE_LIMIT = 80;

export interface RerankFactors {
  stage1: number;
  semantic: number;
  lexical: number;
  intent: number;
  evidence: number;
  graph: number;
}

export interface RerankExplanation {
  version: typeof CONTEXTUAL_RERANK_VERSION;
  original_rank: number;
  final_rank: number;
  score: number;
  factors: RerankFactors;
}

export interface RerankOptions {
  candidateLimit?: number;
}

const WEIGHTS = {
  stage1: 0.53,
  semantic: 0.25,
  lexical: 0.12,
  intent: 0.05,
  evidence: 0.05,
} as const;

/** Exact identities are immutable anchors, not probabilistic rerank inputs. */
export function isAuthorityResult(result: ScoredResult): boolean {
  return result.reasons.some(reason =>
    reason.channel === 'exact_id' || reason.channel === 'exact_title' || reason.channel === 'source_file'
  );
}

/**
 * Pure local second-stage reranking. Authority rows remain at their original
 * indices, while graph provenance and first-stage reasons remain untouched.
 */
export function rerankCandidates(
  results: readonly ScoredResult[],
  plan: QueryPlan,
  options: RerankOptions = {},
): ScoredResult[] {
  const candidateLimit = options.candidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT;
  if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) return [...results];

  const originalRank = new Map(results.map((result, index) => [result.card.id, index + 1]));
  const sourceScores = new Map(results.map(result => [result.card.id, normalizeStage1(result.score)]));
  const head = results.slice(0, candidateLimit);
  const protectedByIndex = new Map<number, ScoredResult>();
  const rerankable: ScoredResult[] = [];

  head.forEach((result, index) => {
    if (isAuthorityResult(result)) protectedByIndex.set(index, result);
    else rerankable.push(withRerankScore(result, plan, originalRank.get(result.card.id)!, sourceScores));
  });
  rerankable.sort((left, right) =>
    (right.rerank!.score - left.rerank!.score)
      || (originalRank.get(left.card.id)! - originalRank.get(right.card.id)!)
      || left.card.id.localeCompare(right.card.id)
  );

  let cursor = 0;
  const merged = head.map((result, index) => protectedByIndex.get(index) ?? rerankable[cursor++]);
  const final = [...merged, ...results.slice(candidateLimit)];
  return final.map((result, index) => {
    if (!result.rerank) return result;
    return { ...result, rerank: { ...result.rerank, final_rank: index + 1 } };
  });
}

function withRerankScore(
  result: ScoredResult,
  plan: QueryPlan,
  originalRank: number,
  sourceScores: ReadonlyMap<string, number>,
): ScoredResult {
  const semanticSimilarity = Math.max(0, ...result.reasons.map(reason => reason.similarity ?? 0));
  const factors: RerankFactors = {
    stage1: normalizeStage1(result.score),
    semantic: clamp((semanticSimilarity - 0.5) / 0.5),
    lexical: lexicalCoverage(plan.terms, searchableText(result)),
    intent: plan.preferredTypes.length === 0 ? 0.5 : (plan.preferredTypes.includes(result.card.type) ? 1 : 0),
    evidence: evidenceStrength(result),
    graph: result.graph_distance === 0 ? 1 : 1 / (1 + result.graph_distance),
  };
  let score = round6(
    factors.stage1 * WEIGHTS.stage1
      + factors.semantic * WEIGHTS.semantic
      + factors.lexical * WEIGHTS.lexical
      + factors.intent * WEIGHTS.intent
      + factors.evidence * WEIGHTS.evidence
  );
  if (result.graph_distance > 0 && result.from_card) {
    const sourceScore = sourceScores.get(result.from_card);
    if (sourceScore !== undefined) score = Math.min(score, round6(sourceScore * 0.75));
  }
  return {
    ...result,
    score,
    rerank: {
      version: CONTEXTUAL_RERANK_VERSION,
      original_rank: originalRank,
      final_rank: originalRank,
      score,
      factors,
    },
  };
}

function searchableText(result: ScoredResult): string {
  return [
    result.card.id,
    result.card.type,
    result.card.title,
    result.card.summary ?? '',
    result.card.file_path,
    result.rerank_text ?? '',
    ...result.reasons.map(reason => reason.heading ?? ''),
  ].join('\n').toLowerCase();
}

function lexicalCoverage(terms: readonly string[], text: string): number {
  if (terms.length === 0) return 0;
  const matched = terms.filter(term => text.includes(term.toLowerCase())).length;
  return clamp(matched / terms.length);
}

function evidenceStrength(result: ScoredResult): number {
  if (result.reasons.some(reason => reason.channel === 'alias' || reason.channel === 'source_file_prefix')) return 0.95;
  if (result.reasons.some(reason => reason.channel === 'semantic')) return 0.9;
  if (result.reasons.some(reason => reason.channel === 'fts' || reason.channel === 'title_phrase' || reason.channel === 'title_token')) return 0.8;
  if (result.reasons.some(reason => reason.channel === 'tag' || reason.channel === 'tag_token')) return 0.7;
  if (result.graph_distance > 0) return 0.4;
  return 0.5;
}

function normalizeStage1(score: number): number {
  return clamp(score / 1.15);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
