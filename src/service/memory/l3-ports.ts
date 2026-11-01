import type { L3IndexStatus, L3Keyword, L3KeywordKind } from '../../domain/memory/l3';

export interface L3KeywordInput {
  id?: string;
  term: string;
  aliases: readonly string[];
  kind: L3KeywordKind;
  baseWeight: number;
  relatedSpaceIds: readonly string[];
  sourceL2Ids: readonly string[];
  expiresAt: string;
  now: string;
  mergeSources?: boolean;
}

export interface L3Repository {
  upsertKeyword(input: L3KeywordInput): L3Keyword;
  getKeyword(id: string, readableSpaceIds: readonly string[], now: string): L3Keyword | undefined;
  match(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    now: string,
    limit: number
  ): L3Keyword[];
  list(
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    now: string,
    limit: number
  ): L3Keyword[];
  recordHits(ids: readonly string[], now: string, expiresAt: string): void;
  l2Hash(l2Id: string): string | undefined;
  listRelatedKeywords(l2Ids: readonly string[], now: string, limit: number): L3Keyword[];
  expireKeywords(now: string): number;
  cleanupExpired(cutoff: string): number;
  checkSearchIndex(): L3IndexStatus;
  rebuildSearchIndex(): void;
}
