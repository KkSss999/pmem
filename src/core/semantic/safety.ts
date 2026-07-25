import type { SemanticCardDocument } from './types';
import { isTrustLabel } from '../trustLabels';

export type SemanticExclusionReason =
  | 'secret'
  | 'untrusted'
  | 'candidate'
  | 'deleted'
  | 'superseded';

export type SemanticTrustExclusionDetail =
  | 'missing_trust_label'
  | 'invalid_trust_label'
  | 'non_indexable_trust_label';

/** Explicit allowlist: unlabeled and agent/tool supplied content is default-untrusted. */
export const SEMANTIC_TRUSTED_LABELS = new Set([
  'system_trusted',
  'user_confirmed',
  'application_trusted',
]);

export function semanticTrustExclusionDetail(card: SemanticCardDocument): SemanticTrustExclusionDetail | null {
  const label = card.frontmatter?.trust_label;
  if (typeof label !== 'string' || label.trim() === '') return 'missing_trust_label';
  if (!isTrustLabel(label)) return 'invalid_trust_label';
  return SEMANTIC_TRUSTED_LABELS.has(label) ? null : 'non_indexable_trust_label';
}

export function semanticExclusionReason(card: SemanticCardDocument): SemanticExclusionReason | null {
  if (card.frontmatter?.sensitivity === 'secret') return 'secret';
  if (semanticTrustExclusionDetail(card)) return 'untrusted';
  if (card.isCandidate) return 'candidate';
  if (card.isDeleted) return 'deleted';
  if ((card.frontmatter?.superseded_by?.length ?? 0) > 0) return 'superseded';
  return null;
}

export function isSemanticSafeCard(card: SemanticCardDocument): boolean {
  return semanticExclusionReason(card) === null;
}

export function filterSafeSemanticCards(cards: readonly SemanticCardDocument[]): SemanticCardDocument[] {
  return cards.filter(isSemanticSafeCard);
}
