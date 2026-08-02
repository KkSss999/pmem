/** JSON-compatible value used by ContextPack metadata and provenance. */
export type ContextPackJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ContextPackJsonValue[]
  | { readonly [key: string]: ContextPackJsonValue };

export interface ContextPackSource {
  path?: string;
  uri?: string;
  label?: string;
  line?: number;
  column?: number;
}

export interface ContextPackEvidenceInput {
  /** Stable caller-provided id. One is generated when omitted. */
  id?: string;
  recordId: string;
  kind?: string;
  content: string;
  score?: number;
  source?: ContextPackSource;
  metadata?: Readonly<Record<string, ContextPackJsonValue>>;
}

export interface ContextPackRecordInput {
  id: string;
  content: string;
  title?: string;
  type?: string;
  score?: number;
  source?: ContextPackSource;
  metadata?: Readonly<Record<string, ContextPackJsonValue>>;
  /** Evidence may be supplied on a record or in the top-level evidence list. */
  evidence?: readonly ContextPackEvidenceInput[];
}

export interface ContextPackInput {
  query: string;
  records: readonly ContextPackRecordInput[];
  evidence?: readonly ContextPackEvidenceInput[];
  provenance?: Readonly<Record<string, ContextPackJsonValue>>;
  /** Optional input-level budget; packContext options take precedence. */
  budget?: number;
  tokenBudget?: number;
}

export interface ContextPackRecord {
  id: string;
  content: string;
  title?: string;
  type?: string;
  score?: number;
  source?: ContextPackSource;
  metadata?: Readonly<Record<string, ContextPackJsonValue>>;
  truncated?: boolean;
}

export interface ContextPackEvidence {
  id: string;
  recordId: string;
  content: string;
  kind?: string;
  score?: number;
  source?: ContextPackSource;
  metadata?: Record<string, ContextPackJsonValue>;
  truncated?: boolean;
}

export type ContextPackOmissionKind = 'record' | 'evidence' | 'query';
export type ContextPackOmissionReason =
  | 'budget'
  | 'duplicate'
  | 'invalid'
  | 'orphaned-record';

export interface ContextPackOmission {
  kind: ContextPackOmissionKind;
  id: string;
  reason: ContextPackOmissionReason;
  estimatedTokens: number;
}

export interface ContextPackDiagnostics {
  truncated: boolean;
  omissions: ContextPackOmission[];
  omittedRecordIds: string[];
  omittedEvidenceIds: string[];
}

export interface ContextPackBudget {
  requestedTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export interface ContextPack {
  /** Version of the wire shape, independent of pmem's release version. */
  schemaVersion: '1';
  query: string;
  records: ContextPackRecord[];
  evidence: ContextPackEvidence[];
  provenance: Record<string, ContextPackJsonValue>;
  budget: ContextPackBudget;
  diagnostics: ContextPackDiagnostics;
  /** Deterministic, ready-to-inject textual representation. */
  text: string;
}

export interface PackContextOptions {
  /** Maximum estimated tokens for query, records, evidence, and text. */
  budget?: number;
  tokenBudget?: number;
  maxRecords?: number;
  maxEvidencePerRecord?: number;
}
