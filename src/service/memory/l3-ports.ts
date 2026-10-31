import type {
  L3Change,
  L3ChangeState,
  L3IndexStatus,
  L3Job,
  L3Keyword,
  L3KeywordKind,
  L3ResultState,
} from '../../domain/memory/l3';

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
  listChanges(readableSpaceIds: readonly string[], limit: number): L3Change[];
  enqueueColdStart(readableSpaceIds: readonly string[], limit: number, now: string): number;
  l2Hash(l2Id: string): string | undefined;
  listRelatedKeywords(l2Ids: readonly string[], now: string, limit: number): L3Keyword[];
  createJob(job: L3Job): L3Job;
  getJob(id: string): L3Job | undefined;
  setPromptVersion(id: string, runId: string, version: string, now: string): void;
  claim(
    id: string,
    runId: string,
    now: string,
    batchSize: number
  ): { job: L3Job; changes: L3Change[] } | undefined;
  finishChanges(
    ids: readonly string[],
    state: L3ChangeState,
    jobId: string,
    reason: string | undefined,
    now: string
  ): void;
  recordResult(
    jobId: string,
    resultIndex: number,
    state: L3ResultState,
    action: 'upsert',
    keywordId: string | undefined,
    l2Ids: readonly string[],
    errorCode: string | undefined,
    now: string
  ): void;
  finishJob(
    id: string,
    runId: string,
    state: 'succeeded' | 'partial' | 'failed' | 'unknown',
    errorCode: string | undefined,
    errorMessage: string | undefined,
    now: string
  ): void;
  retryJob(id: string, state: 'failed' | 'unknown' | 'partial', now: string): L3Job | undefined;
  expireKeywords(now: string): number;
  cleanupExpired(cutoff: string): number;
  checkSearchIndex(): L3IndexStatus;
  rebuildSearchIndex(): void;
}
