import type { L0Message, MemorySpace } from './types';

export type L1JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';

export type L1IndexStatus = 'healthy' | 'missing' | 'stale' | 'corrupt' | 'unavailable';

export interface L1Job {
  id: string;
  spaceId: string;
  sourceIds: readonly string[];
  relatedSpaceIds: readonly string[];
  state: L1JobState;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  claimToken?: string;
}

export interface L1JobPage {
  jobs: readonly L1Job[];
  nextId?: string;
}

export interface L1Memory {
  id: string;
  jobId: string;
  spaceId: string;
  content: string;
  abstraction: string;
  cues: readonly string[];
  sourceIds: readonly string[];
  sourcesComplete: boolean;
  relatedSpaceIds: readonly string[];
  maintenanceStatus: 'pending' | 'complete' | 'failed';
  createdAt: string;
}

export interface L1Draft {
  content: string;
  abstraction: string;
  cues: readonly string[];
  sourceIds: readonly string[];
  relatedSpaceIds: readonly string[];
}

/** Model output is untrusted until the application service validates it. */
export interface L1ExtractionModel {
  extract(input: {
    messages: readonly L0Message[];
    space: MemorySpace;
    relatedSpaces: readonly MemorySpace[];
  }): Promise<unknown>;
}

/** Whether the remote request may have run is relevant to retry handling. */
export class L1ModelError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'failed' | 'unknown',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'L1ModelError';
  }
}
