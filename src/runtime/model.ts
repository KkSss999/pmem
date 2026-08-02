/**
 * Canonical, backend-neutral memory model for the v1.3 Runtime.
 *
 * These types intentionally contain no SQLite, Markdown, Card, or Manifest
 * details.  Adapters are responsible for translating their native shape to
 * this model at the Runtime boundary.
 */

export type MemoryJsonPrimitive = string | number | boolean | null;
export type MemoryJsonValue = MemoryJsonPrimitive | MemoryJsonObject | MemoryJsonValue[];
export interface MemoryJsonObject {
  [key: string]: MemoryJsonValue;
}

/** A stable namespace/scope identifier owned by the Runtime. */
export type MemoryScope = string;

/** Structured scope metadata for callers that need to inspect a scope. */
export interface MemoryScopeRef {
  id: MemoryScope;
  kind?: string;
  parent?: MemoryScope;
  namespace?: string;
}

/** Where a record/event came from and which actor caused it. */
export interface MemoryProvenance {
  source?: string;
  source_id?: string;
  actor?: string;
  reason?: string;
  imported_at?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySchemaRef {
  id: string;
  version: string;
}

export type MemoryFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'relation'
  | 'unknown'
  | (string & {});

export interface MemorySchemaField {
  name: string;
  type: MemoryFieldType;
  required?: boolean;
  indexed?: boolean;
  searchable?: boolean;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Immutable schema description used to validate and decode records. */
export interface SchemaSnapshot {
  ref: MemorySchemaRef;
  fields: readonly MemorySchemaField[];
  primary_key?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Public name used by Runtime callers; snapshots are immutable by contract. */
export interface MemorySchema extends SchemaSnapshot {}
export type MemorySchemaSnapshot = SchemaSnapshot;

export interface MemorySchemaRegistry {
  resolve(ref: MemorySchemaRef): MaybePromise<MemorySchema | null>;
  list(): MaybePromise<readonly MemorySchema[]>;
  register?(schema: MemorySchema): MaybePromise<void>;
}

export type MemoryRecordState = 'active' | 'superseded' | 'forgotten' | (string & {});

export interface MemoryRecord {
  id: string;
  schema: MemorySchemaRef;
  data: Record<string, unknown>;
  scope: MemoryScope;
  provenance: MemoryProvenance;
  created_at: string;
  updated_at: string;
  state?: MemoryRecordState;
  version?: number;
  relations?: readonly MemoryRelation[];
}

export type MemoryEventType =
  | 'observe'
  | 'commit'
  | 'supersede'
  | 'forget'
  | 'session_end'
  | (string & {});

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  scope: MemoryScope;
  created_at: string;
  payload: Record<string, unknown>;
  record_id?: string;
  schema?: MemorySchemaRef;
  provenance?: MemoryProvenance;
}

export interface MemoryRelation {
  id?: string;
  from_id: string;
  to_id: string;
  type: string;
  scope?: MemoryScope;
  created_at?: string;
  provenance?: MemoryProvenance;
  metadata?: Record<string, unknown>;
}

export interface MemoryFilter {
  field: string;
  operator?: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: unknown;
}

export interface MemorySort {
  field: string;
  direction?: 'asc' | 'desc';
}

export interface MemoryRelationQuery {
  from_id?: string;
  to_id?: string;
  type?: string;
  depth?: number;
}

/** Backend-neutral structured query. Full-text/semantic search is separate. */
export interface BackendQuery {
  schema?: MemorySchemaRef;
  scope?: MemoryScope | readonly MemoryScope[];
  filters?: readonly MemoryFilter[];
  relation?: MemoryRelationQuery;
  order_by?: readonly MemorySort[];
  limit?: number;
  cursor?: string;
}

export interface MemoryQueryResult {
  records: readonly MemoryRecord[];
  next_cursor?: string;
  total?: number;
}

export interface MemorySearchDocument {
  record_id: string;
  text?: string;
  fields?: Record<string, unknown>;
  embedding?: readonly number[];
}

export interface MemorySearchRequest {
  text?: string;
  fields?: readonly string[];
  scope?: MemoryScope | readonly MemoryScope[];
  schema?: MemorySchemaRef;
  limit?: number;
  cursor?: string;
}

export interface MemorySearchHit {
  record_id: string;
  score: number;
  channels?: readonly string[];
  highlights?: readonly string[];
}

export interface MemorySearchResult {
  hits: readonly MemorySearchHit[];
  next_cursor?: string;
}

export interface BackendCapabilities {
  transactions: {
    atomic: boolean;
    isolation?: 'none' | 'read_committed' | 'snapshot' | 'serializable' | (string & {});
  };
  query: {
    structured: boolean;
    fulltext: boolean;
    graph: boolean;
    semantic: boolean;
  };
  relations: boolean;
  search_index: boolean;
  projections?: boolean;
}

export interface BackendOpenContext {
  root: string;
  schema: MemorySchemaRegistry;
}

export interface BackendTransactionOptions {
  correlation_id?: string;
  principal?: string;
  scope?: MemoryScope;
}

/** The atomic write surface shared by all backends. */
export interface BackendTransaction {
  readonly id: string;
  readonly atomic: boolean;

  getRecord(id: string): MaybePromise<MemoryRecord | null>;
  putRecord(record: MemoryRecord): MaybePromise<void>;
  deleteRecord(id: string, event?: MemoryEvent): MaybePromise<void>;
  appendEvent(event: MemoryEvent): MaybePromise<MemoryEvent>;
  putRelation(relation: MemoryRelation): MaybePromise<void>;
  removeRelation(relation: Pick<MemoryRelation, 'from_id' | 'to_id' | 'type'>): MaybePromise<void>;
  upsertSearchDocument(document: MemorySearchDocument): MaybePromise<void>;
  query(query: BackendQuery): MaybePromise<MemoryQueryResult>;
  commit(): MaybePromise<void>;
  rollback(reason?: unknown): MaybePromise<void>;
}

/**
 * Pluggable persistence contract. Implementations may be SQLite, a remote
 * store, or another local backend; Runtime code must depend only on this port.
 */
export interface MemoryBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;

  open(context: BackendOpenContext): MaybePromise<void>;
  close(): MaybePromise<void>;
  getRecord(id: string): MaybePromise<MemoryRecord | null>;
  query(query: BackendQuery): MaybePromise<MemoryQueryResult>;
  search(request: MemorySearchRequest): MaybePromise<MemorySearchResult>;
  beginTransaction(options?: BackendTransactionOptions): MaybePromise<BackendTransaction>;
}

export type MaybePromise<T> = T | PromiseLike<T>;
