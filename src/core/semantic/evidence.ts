/**
 * Serializable evidence emitted by the semantic retrieval layer.
 *
 * Semantic evidence is intentionally marked as `supporting`: it can discover
 * useful candidates, but deterministic retrieval remains authoritative during
 * fusion and final ranking.
 */

export const SEMANTIC_EVIDENCE_VERSION = 1 as const;

export type SemanticEvidenceAuthority = 'supporting';

/** Metadata required to reproduce or explain a semantic score. */
export interface SemanticEvidenceProvenance {
  model: string;
  revision: string;
  dimension: number;
  chunkStrategy: string;
}

/** Stable identity of the record that owns the matched chunk. */
export interface SemanticEvidenceParentRecord {
  id: string;
  type?: string | null;
  title?: string | null;
}

export type SemanticFallbackStrategy = 'none' | 'deterministic' | 'exact' | 'lexical' | 'structured';

/** Why semantic retrieval was unavailable or intentionally degraded. */
export type SemanticDegradationReason = string;

export interface SemanticEvidenceFallback {
  strategy: SemanticFallbackStrategy;
  reason: SemanticDegradationReason;
}

export interface SemanticEvidence {
  /** Schema version for this serializable evidence object. */
  evidenceVersion: typeof SEMANTIC_EVIDENCE_VERSION;
  /** Semantic never outranks deterministic authority by itself. */
  authority: SemanticEvidenceAuthority;
  provenance: SemanticEvidenceProvenance;
  chunkId: string;
  heading: string | null;
  headingPath: string[];
  similarity: number;
  parentRecord: SemanticEvidenceParentRecord;
  fallback: SemanticEvidenceFallback | null;
  degradationReason: SemanticDegradationReason | null;
}

export interface SemanticEvidenceInput {
  provenance: SemanticEvidenceProvenance;
  chunkId: string;
  heading?: string | null;
  headingPath?: readonly string[];
  similarity: number;
  /** Either a full parent record or its stable id. */
  parentRecord?: SemanticEvidenceParentRecord | string;
  parentRecordId?: string;
  fallback?: SemanticEvidenceFallback | null;
  degradationReason?: SemanticDegradationReason | null;
}

export interface SemanticEvidenceValidation {
  valid: boolean;
  errors: string[];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneParentRecord(value: SemanticEvidenceInput['parentRecord'], fallbackId?: string): SemanticEvidenceParentRecord {
  if (typeof value === 'string') return { id: value };
  if (value && typeof value === 'object') {
    return {
      id: value.id,
      ...(value.type !== undefined ? { type: value.type } : {}),
      ...(value.title !== undefined ? { title: value.title } : {}),
    };
  }
  return { id: fallbackId ?? '' };
}

function cloneProvenance(value: SemanticEvidenceProvenance): SemanticEvidenceProvenance {
  return {
    model: value.model,
    revision: value.revision,
    dimension: value.dimension,
    chunkStrategy: value.chunkStrategy,
  };
}

/**
 * Return all validation errors without throwing. This is useful at API
 * boundaries where malformed provenance should be reported as data.
 */
export function semanticEvidenceIssues(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['evidence must be an object'];
  }
  const evidence = value as Partial<SemanticEvidence>;
  if (evidence.evidenceVersion !== SEMANTIC_EVIDENCE_VERSION) errors.push(`evidenceVersion must be ${SEMANTIC_EVIDENCE_VERSION}`);
  if (evidence.authority !== 'supporting') errors.push('authority must be supporting');
  if (!evidence.provenance || typeof evidence.provenance !== 'object') {
    errors.push('provenance is required');
  } else {
    const provenance = evidence.provenance as Partial<SemanticEvidenceProvenance>;
    if (!nonEmptyString(provenance.model)) errors.push('provenance.model must be a non-empty string');
    if (!nonEmptyString(provenance.revision)) errors.push('provenance.revision must be a non-empty string');
    if (!Number.isInteger(provenance.dimension) || (provenance.dimension ?? 0) <= 0) errors.push('provenance.dimension must be a positive integer');
    if (!nonEmptyString(provenance.chunkStrategy)) errors.push('provenance.chunkStrategy must be a non-empty string');
  }
  if (!nonEmptyString(evidence.chunkId)) errors.push('chunkId must be a non-empty string');
  if (evidence.heading !== null && evidence.heading !== undefined && typeof evidence.heading !== 'string') errors.push('heading must be a string or null');
  if (!Array.isArray(evidence.headingPath) || evidence.headingPath.some(value => typeof value !== 'string')) errors.push('headingPath must be an array of strings');
  if (!finiteNumber(evidence.similarity) || evidence.similarity < -1 || evidence.similarity > 1) errors.push('similarity must be a finite number between -1 and 1');
  if (!evidence.parentRecord || typeof evidence.parentRecord !== 'object' || !nonEmptyString(evidence.parentRecord.id)) errors.push('parentRecord.id must be a non-empty string');
  if (evidence.fallback !== null && evidence.fallback !== undefined) {
    if (typeof evidence.fallback !== 'object') errors.push('fallback must be an object or null');
    else {
      const fallback = evidence.fallback as Partial<SemanticEvidenceFallback>;
      if (!['none', 'deterministic', 'exact', 'lexical', 'structured'].includes(fallback.strategy ?? '')) errors.push('fallback.strategy is invalid');
      if (!nonEmptyString(fallback.reason)) errors.push('fallback.reason must be a non-empty string');
      if (fallback.strategy === 'none') errors.push('fallback.strategy cannot be none when fallback is present');
    }
  }
  if (evidence.degradationReason !== null && evidence.degradationReason !== undefined && !nonEmptyString(evidence.degradationReason)) errors.push('degradationReason must be a non-empty string or null');
  return errors;
}

/** Structured validation result for callers that should not throw. */
export function validateSemanticEvidence(value: unknown): SemanticEvidenceValidation {
  const errors = semanticEvidenceIssues(value);
  return { valid: errors.length === 0, errors };
}

/** Type guard for data crossing a serialization or extension boundary. */
export function isSemanticEvidence(value: unknown): value is SemanticEvidence {
  return semanticEvidenceIssues(value).length === 0;
}

/** Validate and throw a concise error when evidence is malformed. */
export function assertSemanticEvidence(value: unknown): asserts value is SemanticEvidence {
  const errors = semanticEvidenceIssues(value);
  if (errors.length > 0) throw new Error(`Invalid semantic evidence: ${errors.join('; ')}`);
}

/**
 * Construct canonical, JSON-safe evidence. The input is copied so callers can
 * safely reuse mutable query/result objects without changing the evidence.
 */
export function createSemanticEvidence(input: SemanticEvidenceInput): SemanticEvidence {
  const parentRecord = cloneParentRecord(input.parentRecord, input.parentRecordId);
  const evidence: SemanticEvidence = {
    evidenceVersion: SEMANTIC_EVIDENCE_VERSION,
    authority: 'supporting',
    provenance: cloneProvenance(input.provenance),
    chunkId: input.chunkId,
    heading: input.heading ?? null,
    headingPath: [...(input.headingPath ?? [])],
    similarity: input.similarity,
    parentRecord,
    fallback: input.fallback ? {
      strategy: input.fallback.strategy,
      reason: input.fallback.reason,
    } : null,
    degradationReason: input.degradationReason ?? null,
  };
  assertSemanticEvidence(evidence);
  return evidence;
}

/** Stable, non-mutating ordering for semantic evidence. */
export function sortSemanticEvidence(values: readonly SemanticEvidence[]): SemanticEvidence[] {
  return values.map(value => ({
    ...value,
    provenance: { ...value.provenance },
    headingPath: [...value.headingPath],
    parentRecord: { ...value.parentRecord },
    fallback: value.fallback ? { ...value.fallback } : null,
  })).sort((left, right) =>
    right.similarity - left.similarity
    || left.parentRecord.id.localeCompare(right.parentRecord.id)
    || left.chunkId.localeCompare(right.chunkId)
    || left.headingPath.join('\u0000').localeCompare(right.headingPath.join('\u0000'))
  );
}
