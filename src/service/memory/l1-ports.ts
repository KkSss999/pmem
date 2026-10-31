import type { L0Message } from '../../domain/memory/types';
import type {
  L1Draft,
  L1IndexStatus,
  L1Job,
  L1JobPage,
  L1JobState,
  L1Memory,
} from '../../domain/memory/l1';

export interface L1Repository {
  createJob(job: L1Job, readableSpaceIds: readonly string[]): L1Job;
  getJob(id: string, readableSpaceIds: readonly string[]): L1Job | undefined;
  listJobs(
    spaceId: string,
    state: L1JobState | undefined,
    afterId: string | undefined,
    limit: number,
    readableSpaceIds: readonly string[]
  ): L1JobPage;
  claimJob(
    id: string,
    writableSpaceIds: readonly string[],
    token: string,
    now: string
  ): L1Job | undefined;
  getSources(ids: readonly string[], readableSpaceIds: readonly string[]): L0Message[];
  completeJob(
    job: L1Job,
    input: readonly L0Message[],
    drafts: readonly L1Draft[],
    now: string
  ): void;
  failJob(id: string, token: string, state: 'failed' | 'unknown', code: string, now: string): void;
  retryJob(id: string, state: 'failed' | 'unknown', now: string): L1Job | undefined;
  getMemory(id: string, readableSpaceIds: readonly string[]): L1Memory | undefined;
  updateSpaceLinks(
    id: string,
    relatedSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    writableSpaceIds: readonly string[],
    now: string
  ): L1Memory;
  listJobMemories(jobId: string, readableSpaceIds: readonly string[]): L1Memory[];
  checkSearchIndex(): L1IndexStatus;
  rebuildSearchIndex(): void;
  searchMemories(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L1Memory[];
}
