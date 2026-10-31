import type {
  L2Change,
  L2ChangeState,
  L2IndexStatus,
  L2Job,
  L2Memory,
  L2ResultState,
} from '../../domain/memory/l2';
import type { L2Action } from '../../domain/memory/l2';

export interface L2Repository {
  recordChange(change: L2Change): L2Change;
  listChanges(ownerSpaceId: string, readableSpaceIds: readonly string[], limit: number): L2Change[];
  createJob(job: L2Job): L2Job;
  getJob(id: string, readableSpaceIds: readonly string[]): L2Job | undefined;
  setPromptVersion(id: string, token: string, version: string, now: string): void;
  claim(
    id: string,
    writableSpaceIds: readonly string[],
    token: string,
    now: string
  ): { job: L2Job; changes: L2Change[] } | undefined;
  listCandidates(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  listLinkedCandidates(
    ownerSpaceId: string,
    l1Ids: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  getMemory(id: string, readableSpaceIds: readonly string[]): L2Memory | undefined;
  listMemories(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  applyCreate(
    job: L2Job,
    input: {
      title: string;
      summary: string;
      body: string;
      l1Ids: readonly string[];
      sourceIds: readonly string[];
      relatedSpaceIds: readonly string[];
      generationId: string;
      contentHash: string;
      now: string;
    }
  ): L2Memory;
  applyUpdate(
    job: L2Job,
    input: {
      l2Id: string;
      expectedHash: string;
      expectedL1Ids: readonly string[];
      title: string;
      summary: string;
      body: string;
      l1Ids: readonly string[];
      sourceIds: readonly string[];
      relatedSpaceIds: readonly string[];
      generationId: string;
      contentHash: string;
      now: string;
    }
  ): L2Memory;
  refreshChangeHash(id: string, l1Hash: string): void;
  finishChanges(
    ids: readonly string[],
    state: L2ChangeState,
    jobId: string,
    reason: string | undefined,
    now: string
  ): void;
  recordResult(
    jobId: string,
    resultIndex: number,
    state: L2ResultState,
    action: L2Action,
    l2Id: string | undefined,
    errorCode: string | undefined,
    now: string
  ): void;
  finishJob(
    id: string,
    token: string,
    state: 'succeeded' | 'partial' | 'failed' | 'unknown',
    failureCode: string | undefined,
    now: string
  ): void;
  retryJob(id: string, state: 'failed' | 'unknown' | 'partial', now: string): L2Job | undefined;
  checkSearchIndex(): L2IndexStatus;
  rebuildSearchIndex(): void;
  search(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
}
