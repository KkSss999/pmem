import * as path from 'path';
import type { AskOptions, AskResultV03 } from '../core/query/ask';
import type { RecallQueryResult } from '../core/query/recall';
import type { RelatedResult } from '../core/query/related';
import type { StatusResult } from '../core/query/status';
import type { CaptureOptions, CaptureResult } from '../core/capture';
import type { ContextQueryResult, MemoryCard } from '../types';

export type RuntimePreset = 'software' | 'research' | 'novel' | (string & {});
export type MemoryScopeKind = 'system' | 'user' | 'application' | 'workspace' | 'agent' | 'task' | 'session' | 'private' | 'shared' | (string & {});

export interface NamespaceAddress {
  systemId?: string;
  userId?: string;
  appId?: string;
  workspaceId?: string;
  agentId?: string;
  taskId?: string;
  sessionId?: string;
}

export interface MemoryAddress extends NamespaceAddress {
  memoryId: string;
}

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

export type MemoryCapability =
  | 'memory.read' | 'memory.search' | 'memory.observe'
  | 'memory.propose' | 'memory.commit' | 'memory.amend'
  | 'memory.supersede' | 'memory.forget' | 'memory.purge'
  | 'memory.share' | 'memory.export' | 'memory.admin';

export interface CapabilitySet {
  principal: string;
  capabilities: MemoryCapability[];
  scope: string;
}

export interface PmemOpenOptions {
  /** Project root directory. Pmem data is expected at `${root}/.pmem`. */
  root: string;
  /** Runtime preset. Defaults to `software`. */
  preset?: RuntimePreset;
  /** Optional runtime config overrides layered over preset defaults. */
  config?: PartialRuntimeConfig;
  /** Optional capability-based access control sets for multi-agent security. */
  capabilities?: CapabilitySet[];
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

export interface ForgetRequest {
  /** Event or memory identifier to tombstone. */
  id: string;
  /** Human-readable reason retained in the append-only audit event. */
  reason: string;
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
  forget(request: ForgetRequest): Promise<Receipt>;
  capture(summary: string, opts?: CaptureOptions): Promise<CaptureResult>;
  endSession(result: SessionResult): Promise<void>;

  close(): Promise<void>;
}

export function toPmemPath(root: string): string {
  return path.join(root, '.pmem');
}

export type { AskOptions, AskResultV03, CaptureOptions, CaptureResult, ContextQueryResult, MemoryCard, RecallQueryResult, RelatedResult, StatusResult };
