import * as path from 'path';
import type { AskOptions, AskResultV03 } from '../core/query/ask';
import type { RecallQueryResult } from '../core/query/recall';
import type { RelatedResult } from '../core/query/related';
import type { StatusResult } from '../core/query/status';
import type { CaptureOptions, CaptureResult } from '../core/capture';
import type { ContextQueryResult, MemoryCard } from '../types';

export type RuntimePreset = 'software' | 'research' | 'novel' | (string & {});
export type MemoryScopeKind = 'project' | 'branch' | 'session' | 'agent' | 'private';
export type DurableFormat = 'markdown';
export type ConfirmationPolicy = 'required' | 'optional' | 'never';
export type EpisodicCapturePolicy = 'automatic' | 'manual' | 'disabled';

export interface RuntimeConfig {
  preset: RuntimePreset;
  defaultScope: MemoryScopeKind;
  branchAware: boolean;
  working: {
    ttl: string;
  };
  episodic: {
    capture: EpisodicCapturePolicy;
  };
  durable: {
    format: DurableFormat;
    confirmation: ConfirmationPolicy;
  };
}

export interface PmemOpenOptions {
  /** Project root directory. Pmem data is expected at `${root}/.pmem`. */
  root: string;
  /** Runtime preset. Defaults to `software`. */
  preset?: RuntimePreset;
  /** Optional runtime config overrides layered over preset defaults. */
  config?: PartialRuntimeConfig;
}

export type PartialRuntimeConfig = {
  [K in keyof RuntimeConfig]?: RuntimeConfig[K] extends object
    ? Partial<RuntimeConfig[K]>
    : RuntimeConfig[K];
};

export interface RecallOptions {
  budget?: number;
  since?: string;
  recent?: number;
  noTraces?: boolean;
}

export interface RelatedOptions {
  depth?: number;
  type?: string;
  source?: 'explicit' | 'inferred' | 'mention' | 'all';
}

export interface StatusOptions {
  since?: string;
}

export interface Observation {
  file?: string;
  summary?: string;
  action?: string;
  metadata?: Record<string, unknown>;
  at?: string;
}

export interface Receipt {
  id: string;
  type: MemoryEventType;
  scope: string;
  created_at: string;
  requires_confirmation: boolean;
}

export interface SessionResult {
  status?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryEventType = 'observe' | 'commit' | 'supersede' | 'forget' | 'session_end';

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  scope: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface WorkingMemory {
  scope: string;
  events: MemoryEvent[];
  expires_at?: string;
}

export interface MemoryProposal {
  type: MemoryEventType | 'capture';
  scope: string;
  summary?: string;
  file?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface PmemInstance {
  readonly root: string;
  readonly pmemPath: string;
  readonly config: RuntimeConfig;

  ask(query: string, opts?: AskOptions): Promise<AskResultV03>;
  recall(opts?: RecallOptions): Promise<RecallQueryResult>;
  context(task: string, budget?: number): Promise<ContextQueryResult>;
  related(id: string, opts?: RelatedOptions): Promise<RelatedResult>;
  status(opts?: StatusOptions): Promise<StatusResult>;

  observe(change: Observation): Promise<Receipt>;
  capture(summary: string, opts?: CaptureOptions): Promise<CaptureResult>;
  endSession(result: SessionResult): Promise<void>;

  close(): Promise<void>;
}

export function toPmemPath(root: string): string {
  return path.join(root, '.pmem');
}

export type { AskOptions, AskResultV03, CaptureOptions, CaptureResult, ContextQueryResult, MemoryCard, RecallQueryResult, RelatedResult, StatusResult };
