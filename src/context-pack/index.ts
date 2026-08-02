import type {
  ContextPack,
  ContextPackBudget,
  ContextPackEvidence,
  ContextPackEvidenceInput,
  ContextPackInput,
  ContextPackJsonValue,
  ContextPackOmission,
  ContextPackRecord,
  ContextPackRecordInput,
  ContextPackSource,
  PackContextOptions,
} from './types';

export * from './types';

export const CONTEXT_PACK_SCHEMA_VERSION = '1' as const;
export const DEFAULT_CONTEXT_PACK_BUDGET = 2_000;

/** Rough, deterministic token estimate used by the packer (not a model tokenizer). */
export function estimateContextTokens(value: string): number {
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = value.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

/** Backwards-friendly short alias for callers that already use estimateTokens. */
export const estimateTokens = estimateContextTokens;

function clampBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONTEXT_PACK_BUDGET;
  return Math.max(0, Math.floor(value));
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalJson(value: ContextPackJsonValue): ContextPackJsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const object = value as { readonly [key: string]: ContextPackJsonValue };
    const result: Record<string, ContextPackJsonValue> = {};
    for (const key of Object.keys(object).sort()) result[key] = canonicalJson(object[key]);
    return result;
  }
  return value;
}

function canonicalRecordMetadata(value: Record<string, ContextPackJsonValue> | undefined) {
  return value === undefined ? undefined : canonicalJson(value) as Record<string, ContextPackJsonValue>;
}

function canonicalSource(value: ContextPackSource | undefined): ContextPackSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source: ContextPackSource = {};
  if (typeof value.path === 'string' && value.path.trim()) source.path = value.path.trim();
  if (typeof value.uri === 'string' && value.uri.trim()) source.uri = value.uri.trim();
  if (typeof value.label === 'string' && value.label.trim()) source.label = value.label.trim();
  if (Number.isFinite(value.line)) source.line = Math.max(1, Math.floor(value.line as number));
  if (Number.isFinite(value.column)) source.column = Math.max(1, Math.floor(value.column as number));
  return Object.keys(source).length > 0 ? source : undefined;
}

function validScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scoreForSort(value: number | undefined): number {
  return value === undefined ? Number.NEGATIVE_INFINITY : value;
}

function stableCompare(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareStable(a: { id: string; score?: number }, b: { id: string; score?: number }): number {
  const scoreDiff = scoreForSort(b.score) - scoreForSort(a.score);
  return scoreDiff || stableCompare(a.id, b.id);
}

function truncateToTokens(value: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateContextTokens(value) <= budget) return value;
  let result = '';
  for (const character of value) {
    const next = result + character;
    if (estimateContextTokens(next) > budget) break;
    result = next;
  }
  return result.trimEnd();
}

function sourceText(source: ContextPackSource | undefined): string {
  if (!source) return '';
  const locator = source.path ?? source.uri ?? source.label ?? '';
  if (!locator) return '';
  const line = source.line === undefined ? '' : `:${source.line}${source.column === undefined ? '' : `:${source.column}`}`;
  return ` source=${locator}${line}`;
}

function renderRecord(record: ContextPackRecord): string {
  const title = record.title ? ` ${record.title}` : '';
  const type = record.type ? ` type=${record.type}` : '';
  const score = record.score === undefined ? '' : ` score=${record.score}`;
  return `- [${record.id}]${title}${type}${score}${sourceText(record.source)}\n${record.content}`;
}

function renderEvidence(evidence: ContextPackEvidence): string {
  const kind = evidence.kind ? ` ${evidence.kind}` : '';
  const score = evidence.score === undefined ? '' : ` score=${evidence.score}`;
  return `- [${evidence.id}] record=${evidence.recordId}${kind}${score}${sourceText(evidence.source)}\n${evidence.content}`;
}

function renderPack(query: string, records: ContextPackRecord[], evidence: ContextPackEvidence[]): string {
  const sections = [`Query: ${query}`];
  if (records.length) sections.push(`Records:\n${records.map(renderRecord).join('\n')}`);
  if (evidence.length) sections.push(`Evidence:\n${evidence.map(renderEvidence).join('\n')}`);
  return sections.join('\n\n');
}

function addOmission(
  omissions: ContextPackOmission[],
  kind: ContextPackOmission['kind'],
  id: string,
  reason: ContextPackOmission['reason'],
  estimatedTokens: number,
): void {
  omissions.push({ kind, id, reason, estimatedTokens });
}

function normalizeRecords(input: readonly ContextPackRecordInput[], omissions: ContextPackOmission[]): ContextPackRecordInput[] {
  const seen = new Set<string>();
  const records: ContextPackRecordInput[] = [];
  input.forEach((candidate, index) => {
    const id = normalizedText(candidate?.id);
    const content = normalizedText(candidate?.content);
    if (!id || !content) {
      addOmission(omissions, 'record', id || `record-${index + 1}`, 'invalid', estimateContextTokens(content));
      return;
    }
    if (seen.has(id)) {
      addOmission(omissions, 'record', id, 'duplicate', estimateContextTokens(content));
      return;
    }
    seen.add(id);
    records.push({
      id,
      content,
      title: normalizedText(candidate.title) || undefined,
      type: normalizedText(candidate.type) || undefined,
      score: validScore(candidate.score),
      source: canonicalSource(candidate.source),
      metadata: canonicalRecordMetadata(candidate.metadata),
      evidence: candidate.evidence,
    });
  });
  return records.sort(compareStable);
}

function normalizeEvidence(
  topLevel: readonly ContextPackEvidenceInput[] | undefined,
  records: readonly ContextPackRecordInput[],
  omissions: ContextPackOmission[],
  maxEvidencePerRecord: number,
): ContextPackEvidence[] {
  const recordIds = new Set(records.map(record => record.id));
  const candidates: Array<ContextPackEvidenceInput & { sourceIndex: number }> = [];
  let sourceIndex = 0;
  for (const evidence of topLevel ?? []) candidates.push({ ...evidence, sourceIndex: sourceIndex++ });
  for (const record of records) {
    for (const evidence of record.evidence ?? []) candidates.push({ ...evidence, recordId: record.id, sourceIndex: sourceIndex++ });
  }

  // Normalize before generating synthetic ids or enforcing per-record limits.
  // This makes the result independent of the order in which retrievers append
  // their evidence, while still preserving score as the authoritative order.
  candidates.sort((a, b) => {
    const recordDiff = stableCompare(normalizedText(a.recordId), normalizedText(b.recordId));
    if (recordDiff) return recordDiff;
    const scoreDiff = scoreForSort(validScore(b.score)) - scoreForSort(validScore(a.score));
    if (scoreDiff) return scoreDiff;
    const idDiff = stableCompare(normalizedText(a.id), normalizedText(b.id));
    if (idDiff) return idDiff;
    const contentDiff = stableCompare(normalizedText(a.content), normalizedText(b.content));
    return contentDiff || a.sourceIndex - b.sourceIndex;
  });

  const seen = new Set<string>();
  const countByRecord = new Map<string, number>();
  const normalized: ContextPackEvidence[] = [];
  for (const candidate of candidates) {
    const recordId = normalizedText(candidate.recordId);
    const content = normalizedText(candidate.content);
    const id = normalizedText(candidate.id) || `${recordId}:e${(countByRecord.get(recordId) ?? 0) + 1}`;
    if (!recordIds.has(recordId)) {
      addOmission(omissions, 'evidence', id, 'orphaned-record', estimateContextTokens(content));
      continue;
    }
    if (!content) {
      addOmission(omissions, 'evidence', id, 'invalid', 0);
      continue;
    }
    if (seen.has(id)) {
      addOmission(omissions, 'evidence', id, 'duplicate', estimateContextTokens(content));
      continue;
    }
    const count = countByRecord.get(recordId) ?? 0;
    if (count >= maxEvidencePerRecord) {
      addOmission(omissions, 'evidence', id, 'budget', estimateContextTokens(content));
      continue;
    }
    seen.add(id);
    countByRecord.set(recordId, count + 1);
    normalized.push({
      id,
      recordId,
      content,
      kind: normalizedText(candidate.kind) || undefined,
      score: validScore(candidate.score),
      source: canonicalSource(candidate.source),
      metadata: canonicalRecordMetadata(candidate.metadata),
    });
  }
  return normalized.sort((a, b) => stableCompare(a.recordId, b.recordId) || compareStable(a, b));
}

function outputRecord(candidate: ContextPackRecordInput, content: string, truncated: boolean): ContextPackRecord {
  const output: ContextPackRecord = { id: candidate.id, content };
  if (candidate.title) output.title = candidate.title;
  if (candidate.type) output.type = candidate.type;
  if (candidate.score !== undefined) output.score = candidate.score;
  if (candidate.source) output.source = candidate.source;
  if (candidate.metadata) output.metadata = candidate.metadata;
  if (truncated) output.truncated = true;
  return output;
}

function toOutputEvidence(candidate: ContextPackEvidence, content: string, truncated: boolean): ContextPackEvidence {
  const output: ContextPackEvidence = { id: candidate.id, recordId: candidate.recordId, content };
  if (candidate.kind) output.kind = candidate.kind;
  if (candidate.score !== undefined) output.score = candidate.score;
  if (candidate.source) output.source = candidate.source;
  if (candidate.metadata) output.metadata = candidate.metadata;
  if (truncated) output.truncated = true;
  return output;
}

/**
 * Pack query results into a deterministic, JSON-safe ContextPack.
 *
 * This is deliberately a pure function: no clock, random id, filesystem, or
 * model tokenizer is consulted. Equal input produces byte-stable JSON output.
 */
export function packContext(input: ContextPackInput, options: PackContextOptions = {}): ContextPack {
  const omissions: ContextPackOmission[] = [];
  const requestedTokens = clampBudget(options.budget ?? options.tokenBudget ?? input.budget ?? input.tokenBudget);
  const maxRecords = options.maxRecords === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(options.maxRecords));
  const maxEvidence = options.maxEvidencePerRecord === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(options.maxEvidencePerRecord));

  const sourceRecords = normalizeRecords(Array.isArray(input.records) ? input.records : [], omissions);
  const records = sourceRecords.slice(0, maxRecords);
  for (const record of sourceRecords.slice(maxRecords)) {
    addOmission(omissions, 'record', record.id, 'budget', estimateContextTokens(record.content));
  }
  const allEvidence = normalizeEvidence(input.evidence, records, omissions, maxEvidence);

  const originalQuery = normalizedText(input.query);
  const provenance = input.provenance ? canonicalJson(input.provenance) as Record<string, ContextPackJsonValue> : {};
  let query = originalQuery;
  let outputRecords: ContextPackRecord[] = [];
  let outputEvidence: ContextPackEvidence[] = [];
  let text = renderPack(query, outputRecords, outputEvidence);
  let usedTokens = estimateContextTokens(text);
  // Explicit max-* limits and normalization budget limits are omissions too,
  // so surface them as truncation even when the textual token budget fits.
  let truncated = omissions.some(item => item.reason === 'budget');

  if (usedTokens > requestedTokens) {
    const queryBudget = Math.max(0, requestedTokens - estimateContextTokens('Query: '));
    query = truncateToTokens(originalQuery, queryBudget);
    truncated = query !== originalQuery;
    text = renderPack(query, outputRecords, outputEvidence);
    usedTokens = estimateContextTokens(text);
    if (query !== originalQuery) {
      addOmission(omissions, 'query', 'query', 'budget', estimateContextTokens(originalQuery));
    }
    // The fixed "Query: " label itself costs two estimated tokens. For a
    // zero/one-token budget, emit an empty text payload so the hard budget is
    // still respected rather than returning an over-budget header.
    if (estimateContextTokens(renderPack(query, outputRecords, outputEvidence)) > requestedTokens) {
      if (originalQuery && !omissions.some(item => item.kind === 'query')) {
        addOmission(omissions, 'query', 'query', 'budget', estimateContextTokens(originalQuery));
      }
      query = '';
      text = '';
      usedTokens = 0;
    }
  }

  const canFit = (nextText: string) => estimateContextTokens(nextText) <= requestedTokens;
  for (const record of records) {
    const full = outputRecord(record, record.content, false);
    const candidateText = renderPack(query, [...outputRecords, full], outputEvidence);
    if (canFit(candidateText)) {
      outputRecords.push(full);
      text = candidateText;
      usedTokens = estimateContextTokens(text);
      continue;
    }
    const currentTokens = estimateContextTokens(renderPack(query, outputRecords, outputEvidence));
    const remaining = Math.max(0, requestedTokens - currentTokens);
    const prefix = outputRecord(record, '', false);
    const prefixTokens = estimateContextTokens(renderPack(query, [...outputRecords, prefix], outputEvidence));
    const contentBudget = Math.max(0, remaining - Math.max(0, prefixTokens - currentTokens));
    const clipped = truncateToTokens(record.content, contentBudget);
    const clippedRecord = outputRecord(record, clipped, clipped !== record.content);
    const clippedText = renderPack(query, [...outputRecords, clippedRecord], outputEvidence);
    if (clipped && canFit(clippedText)) {
      outputRecords.push(clippedRecord);
      text = clippedText;
      usedTokens = estimateContextTokens(text);
      truncated = true;
      continue;
    }
    addOmission(omissions, 'record', record.id, 'budget', estimateContextTokens(record.content));
    truncated = true;
  }

  for (const evidence of allEvidence) {
    if (!outputRecords.some(record => record.id === evidence.recordId)) {
      addOmission(omissions, 'evidence', evidence.id, 'budget', estimateContextTokens(evidence.content));
      truncated = true;
      continue;
    }
    const full = toOutputEvidence(evidence, evidence.content, false);
    const candidateText = renderPack(query, outputRecords, [...outputEvidence, full]);
    if (canFit(candidateText)) {
      outputEvidence.push(full);
      text = candidateText;
      usedTokens = estimateContextTokens(text);
      continue;
    }
    const currentTokens = estimateContextTokens(renderPack(query, outputRecords, outputEvidence));
    const remaining = Math.max(0, requestedTokens - currentTokens);
    const prefix = toOutputEvidence(evidence, '', false);
    const prefixTokens = estimateContextTokens(renderPack(query, outputRecords, [...outputEvidence, prefix]));
    const contentBudget = Math.max(0, remaining - Math.max(0, prefixTokens - currentTokens));
    const clipped = truncateToTokens(evidence.content, contentBudget);
    const clippedEvidence = toOutputEvidence(evidence, clipped, clipped !== evidence.content);
    const clippedText = renderPack(query, outputRecords, [...outputEvidence, clippedEvidence]);
    if (clipped && canFit(clippedText)) {
      outputEvidence.push(clippedEvidence);
      text = clippedText;
      usedTokens = estimateContextTokens(text);
      truncated = true;
      continue;
    }
    addOmission(omissions, 'evidence', evidence.id, 'budget', estimateContextTokens(evidence.content));
    truncated = true;
  }

  // Keep all diagnostic arrays deterministic, including normalization omissions.
  const diagnostics = {
    truncated,
    omissions: omissions.slice(),
    omittedRecordIds: omissions.filter(item => item.kind === 'record').map(item => item.id),
    omittedEvidenceIds: omissions.filter(item => item.kind === 'evidence').map(item => item.id),
  };
  const budget: ContextPackBudget = {
    requestedTokens,
    usedTokens,
    remainingTokens: Math.max(0, requestedTokens - usedTokens),
  };
  return {
    schemaVersion: CONTEXT_PACK_SCHEMA_VERSION,
    query,
    records: outputRecords,
    evidence: outputEvidence,
    provenance,
    budget,
    diagnostics,
    text,
  };
}
