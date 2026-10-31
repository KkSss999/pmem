import type { L1Memory } from './l1';

export type L2JobState = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'unknown';
export type L2ChangeKind = 'created' | 'content_changed' | 'scope_changed' | 'merged' | 'removed';
export type L2ChangeState = 'pending' | 'claimed' | 'processed' | 'uncovered' | 'failed';
export type L2ResultState = 'committed' | 'failed' | 'skipped';
export type L2Action = 'create' | 'update';
export type L2IndexStatus = 'healthy' | 'missing' | 'stale' | 'corrupt' | 'unavailable';

export interface L2Change {
  id: string;
  l1Id: string;
  ownerSpaceId: string;
  kind: L2ChangeKind;
  l1Hash: string;
  survivorL1Id?: string;
  state: L2ChangeState;
  jobId?: string;
  reason?: string;
  createdAt: string;
  processedAt?: string;
}

export interface L2Job {
  id: string;
  ownerSpaceId: string;
  state: L2JobState;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  claimToken?: string;
  promptVersion?: string;
}

export interface L2Memory {
  id: string;
  ownerSpaceId: string;
  title: string;
  summary: string;
  body: string;
  contentHash: string;
  needsUpdate: boolean;
  visible: boolean;
  generationId: string;
  relatedSpaceIds: readonly string[];
  l1Ids: readonly string[];
  sourceIds: readonly string[];
  sourcesComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface L2GenerationChange {
  change: L2Change;
  memory: L1Memory;
}

export interface L2Candidate {
  memory: L2Memory;
  evidence: readonly L1Memory[];
}

export interface L2Draft {
  action: L2Action;
  l2Id?: string;
  title: string;
  summary: string;
  body: string;
  l1Ids: readonly string[];
}

/** Model output is untrusted until the application service validates it. */
export interface L2GenerationModel {
  readonly promptVersion?: string;
  generate(input: {
    ownerSpaceId: string;
    changes: readonly L2GenerationChange[];
    candidates: readonly L2Candidate[];
    now: string;
  }): Promise<unknown>;
}

export class L2ModelError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'failed' | 'unknown',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'L2ModelError';
  }
}
