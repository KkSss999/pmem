import type { L1Memory } from './l1';
import type { L2Memory } from './l2';

export type L3KeywordKind = 'topic' | 'entity' | 'preference' | 'tool' | 'concept' | 'other';
export type L3KeywordState = 'active' | 'expired';
export type L3IndexStatus = 'healthy' | 'missing' | 'stale' | 'corrupt' | 'unavailable';
export type L3Fallback = 'none' | 'l2' | 'l1';
export type L3ChangeKind = 'created' | 'updated' | 'scope_changed' | 'merged' | 'removed';
export type L3ChangeState = 'pending' | 'claimed' | 'processed' | 'failed';
export type L3JobState = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'unknown';
export type L3ResultState = 'committed' | 'failed' | 'skipped';
export type L3Action = 'upsert';

export interface L3Job {
  id: string;
  state: L3JobState;
  runId?: string;
  promptVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface L3GenerationChange {
  change: L3Change;
  memory: L2Memory;
}

export interface L3Draft {
  term: string;
  aliases: readonly string[];
  kind: L3KeywordKind;
  baseWeight: number;
  l2Ids: readonly string[];
}

/** Model output is untrusted until the application service validates it. */
export interface L3GenerationModel {
  readonly promptVersion?: string;
  readonly l3PromptVersion?: string;
  generateKeywords(input: {
    changes: readonly L3GenerationChange[];
    keywords: readonly L3Keyword[];
    now: string;
  }): Promise<unknown>;
}

export interface L3Change {
  id: string;
  l2Id: string;
  kind: L3ChangeKind;
  l2Hash: string;
  state: L3ChangeState;
  jobId?: string;
  reason?: string;
  createdAt: string;
  processedAt?: string;
}

export interface L3Keyword {
  id: string;
  term: string;
  normalizedTerm: string;
  aliases: readonly string[];
  kind: L3KeywordKind;
  scopeKey: string;
  baseWeight: number;
  weight: number;
  hitCount: number;
  lastHitAt?: string;
  needsRefresh: boolean;
  state: L3KeywordState;
  expiresAt: string;
  relatedSpaceIds: readonly string[];
  sourceL2Ids: readonly string[];
  sourceComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface L3KeywordMatch {
  keywordIds: readonly string[];
  term: string;
  normalizedTerm: string;
  aliases: readonly string[];
  kind: L3KeywordKind;
  weight: number;
  baseWeight: number;
  hitCount: number;
  lastHitAt?: string;
  relatedSpaceIds: readonly string[];
  sourceL2Ids: readonly string[];
  sourceComplete: boolean;
  needsRefresh: boolean;
}

export interface L3MatchOptions {
  limit?: number;
}

export interface L3ListOptions {
  limit?: number;
}

export interface L3ResolveOptions extends L3MatchOptions {
  topK?: number;
  fallback?: boolean;
}

export interface L3ResolveResult {
  cacheHit: boolean;
  mixed: boolean;
  fallback: L3Fallback;
  keywords: readonly L3KeywordMatch[];
  l2: readonly L2Memory[];
  l1: readonly L1Memory[];
  l0SourceIds: readonly string[];
  complete: boolean;
  needsRefresh: boolean;
  truncated: boolean;
}

export class L3ModelError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'failed' | 'unknown',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'L3ModelError';
  }
}

export function normalizeL3Term(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function l3ScopeKey(spaceIds: readonly string[]): string {
  return JSON.stringify([...new Set(spaceIds)].sort());
}
