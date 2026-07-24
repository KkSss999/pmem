import type { SemanticCardDocument } from './types';

export type SemanticExclusionReason =
  | 'secret'
  | 'untrusted'
  | 'candidate'
  | 'deleted'
  | 'superseded';

/** Explicit allowlist: unlabeled and agent/tool supplied content is default-untrusted. */
export const SEMANTIC_TRUSTED_LABELS = new Set([
  'system_trusted',
  'user_confirmed',
  'application_trusted',
]);

export function semanticExclusionReason(card: SemanticCardDocument): SemanticExclusionReason | null {
  if (card.frontmatter?.sensitivity === 'secret') return 'secret';
  if (!card.frontmatter?.trust_label || !SEMANTIC_TRUSTED_LABELS.has(card.frontmatter.trust_label)) return 'untrusted';
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
