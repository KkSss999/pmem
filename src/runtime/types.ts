import * as path from 'path';
import type { MemoryBackend, MemoryEvent, MemoryEventType, MemorySchemaRegistry } from './model';
import type { QueryExecutionResult, QueryPlan } from '../query';

// Keep the historical runtime import path stable while the canonical model
// lives in a backend-neutral module.
export type { MemoryBackend, MemoryEvent, MemoryEventType, MemorySchemaRegistry } from './model';

/** Runtime has no built-in product/domain presets; extensions may name one. */
export type RuntimePreset = string & {};
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
  /** Optional extension-defined configuration profile. */
  preset?: RuntimePreset;
  /** Optional runtime config overrides layered over preset defaults. */
  config?: PartialRuntimeConfig;
  /** Optional capability-based access control sets for multi-agent security. */
  capabilities?: CapabilitySet[];
  /** Canonical Runtime requires an explicit backend. */
  backend?: MemoryBackend;
  /** Optional schema registry used by the selected backend. */
  schema?: MemorySchemaRegistry;
  /**
   * Explicitly supplied v1.2 bridge. It is composed by commands/migration/
   * import surfaces; Runtime never constructs or imports it implicitly.
   */
  legacy?: RuntimeLegacyAdapter;
}

export interface RuntimeLegacyAdapter {
  ask(query: string, opts?: AskOptions): Promise<AskResultV03>;
  recall(opts?: RecallOptions): Promise<RecallQueryResult>;
  context(task: string, budget?: number): Promise<ContextQueryResult>;
  related(id: string, opts?: RelatedOptions): Promise<RelatedResult>;
  status(opts?: StatusOptions): Promise<StatusResult>;
  capture(summary: string, options: CaptureOptions): Promise<CaptureResult>;
  findEvent(id: string): MemoryEvent | null;
  expireEvents(): void;
  mergeBranchMemory(sourceBranch: string, targetBranch: string): number;
}

// Legacy response DTOs remain intentionally opaque to the canonical Runtime.
// Public v1.2 consumers retain their richer declarations through the
// compatibility package; these aliases merely preserve the v1.3 facade shape.
export type AskOptions = { limit?: number; explain?: boolean; now?: number; rerank?: boolean };
export type AskResultV03 = any;
export type CaptureOptions = {
  auto?: boolean;
  summary?: string;
  next?: string;
  full?: boolean;
  force?: boolean;
  cwd?: string;
  deferRuntimeEvent?: boolean;
  [key: string]: unknown;
};
export type CaptureResult = any;
export type ContextQueryResult = any;
export type MemoryCard = any;
export type RecallQueryResult = any;
export type RelatedResult = any;
export type StatusResult = any;

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
  /** v1.1: filter scoped events to those visible to this principal (namespace isolation). */
  principal?: string;
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
  readonly backend: MemoryBackend;

  ask(query: string, opts?: AskOptions): Promise<AskResultV03>;
  query(query: string, limit?: number): Promise<QueryExecutionResult>;
  executeQueryPlan(plan: QueryPlan): Promise<QueryExecutionResult>;
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
