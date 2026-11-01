import type { L1Memory } from './l1';

export type L2ChangeKind = 'created' | 'content_changed' | 'scope_changed' | 'merged' | 'removed';
export type L2Action = 'create' | 'update';
export type L2IndexStatus = 'healthy' | 'missing' | 'stale' | 'corrupt' | 'unavailable';

export interface L2Memory {
  id: string;
  ownerSpaceId: string;
  title: string;
  summary: string;
  body: string;
  contentHash: string;
  supersededBy?: string;
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
  l1Id: string;
  kind: L2ChangeKind;
  memory: L1Memory;
}

export interface L2Candidate {
  memory: L2Memory;
  evidence: readonly L1Memory[];
}

export interface L2Draft {
  action: L2Action;
  l2Id?: string;
  supersede?: boolean;
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
