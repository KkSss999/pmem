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
  TokenEstimator,
} from './types';

export * from './types';

export const CONTEXT_PACK_SCHEMA_VERSION = '1' as const;
export const DEFAULT_CONTEXT_PACK_BUDGET = 2_000;
export const DEFAULT_MAX_EVIDENCE_PER_RECORD = 3;
export const DEFAULT_CONTEXT_PACK_DIVERSITY_LAMBDA = 0.85;

/** Rough, deterministic token estimate used by the packer (not a model tokenizer). */
export function estimateContextTokens(value: string): number {
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = value.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

/** The deterministic default estimator; callers may inject a model tokenizer. */
export const DEFAULT_TOKEN_ESTIMATOR: TokenEstimator = Object.freeze({
  estimate: estimateContextTokens,
});

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

function estimateWith(estimator: TokenEstimator, value: string): number {
  const estimate = estimator.estimate(value);
  if (!Number.isFinite(estimate) || estimate < 0) {
    throw new RangeError('TokenEstimator.estimate must return a finite non-negative number');
  }
  return Math.ceil(estimate);
}

function truncateToTokens(value: string, budget: number, estimator: TokenEstimator): string {
  if (budget <= 0) return '';
  if (estimateWith(estimator, value) <= budget) return value;
  let result = '';
  for (const character of value) {
    const next = result + character;
    if (estimateWith(estimator, next) > budget) break;
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

function jsonText(value: Readonly<Record<string, ContextPackJsonValue>> | undefined): string {
  return value && Object.keys(value).length > 0 ? ` ${JSON.stringify(value)}` : '';
}

function renderRecord(record: ContextPackRecord): string {
  const title = record.title ? ` ${record.title}` : '';
  const type = record.type ? ` type=${record.type}` : '';
  const score = record.score === undefined ? '' : ` score=${record.score}`;
  return `- [${record.id}]${title}${type}${score}${sourceText(record.source)}${jsonText(record.metadata)}\n${record.content}`;
}

function renderEvidence(evidence: ContextPackEvidence): string {
  const kind = evidence.kind ? ` ${evidence.kind}` : '';
  const score = evidence.score === undefined ? '' : ` score=${evidence.score}`;
  return `- [${evidence.id}] record=${evidence.recordId}${kind}${score}${sourceText(evidence.source)}${jsonText(evidence.provenance)}${jsonText(evidence.metadata)}\n${evidence.content}`;
}

function renderPack(
  query: string,
  records: ContextPackRecord[],
  evidence: ContextPackEvidence[],
  provenance: Readonly<Record<string, ContextPackJsonValue>> = {},
): string {
  const sections = [`Query: ${query}`];
  if (records.length) sections.push(`Records:\n${records.map(renderRecord).join('\n')}`);
  if (evidence.length) sections.push(`Evidence:\n${evidence.map(renderEvidence).join('\n')}`);
  if (Object.keys(provenance).length > 0) sections.push(`Provenance: ${JSON.stringify(provenance)}`);
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

function normalizeRecords(
  input: readonly ContextPackRecordInput[],
  omissions: ContextPackOmission[],
  estimator: TokenEstimator,
): ContextPackRecordInput[] {
  const seen = new Set<string>();
  const records: ContextPackRecordInput[] = [];
  input.forEach((candidate, index) => {
    const id = normalizedText(candidate?.id);
    const content = normalizedText(candidate?.content);
    if (!id || !content) {
      addOmission(omissions, 'record', id || `record-${index + 1}`, 'invalid', estimateWith(estimator, content));
      return;
    }
    if (seen.has(id)) {
      addOmission(omissions, 'record', id, 'duplicate', estimateWith(estimator, content));
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
  estimator: TokenEstimator,
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
  const nextIdByRecord = new Map<string, number>();
  const normalized: ContextPackEvidence[] = [];
  for (const candidate of candidates) {
    const recordId = normalizedText(candidate.recordId);
    const content = normalizedText(candidate.content);
    const nextId = (nextIdByRecord.get(recordId) ?? 0) + 1;
    nextIdByRecord.set(recordId, nextId);
    const id = normalizedText(candidate.id) || `${recordId}:e${nextId}`;
    if (!recordIds.has(recordId)) {
      addOmission(omissions, 'evidence', id, 'orphaned-record', estimateWith(estimator, content));
      continue;
    }
    if (!content) {
      addOmission(omissions, 'evidence', id, 'invalid', 0);
      continue;
    }
    if (seen.has(id)) {
      addOmission(omissions, 'evidence', id, 'duplicate', estimateWith(estimator, content));
      continue;
    }
    const count = countByRecord.get(recordId) ?? 0;
    if (count >= maxEvidencePerRecord) {
      addOmission(omissions, 'evidence', id, 'budget', estimateWith(estimator, content));
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
      provenance: candidate.provenance ? canonicalRecordMetadata(candidate.provenance) : undefined,
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
  if (candidate.provenance) output.provenance = candidate.provenance;
  if (candidate.metadata) output.metadata = candidate.metadata;
  if (truncated) output.truncated = true;
  return output;
}

function clampDiversityLambda(value: number | undefined): number {
  const lambda = value ?? DEFAULT_CONTEXT_PACK_DIVERSITY_LAMBDA;
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new RangeError('diversityLambda must be a finite number between 0 and 1');
  }
  return lambda;
}

function diversityTerms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function lexicalSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** Deterministic Maximal Marginal Relevance ordering for ContextPack records. */
function orderRecords(records: ContextPackRecordInput[], lambda: number): ContextPackRecordInput[] {
  if (records.length < 2 || lambda === 1) return records.slice().sort(compareStable);
  const scores = records.map(record => record.score).filter((score): score is number => score !== undefined);
  const minScore = scores.length === 0 ? 0 : Math.min(...scores);
  const maxScore = scores.length === 0 ? 0 : Math.max(...scores);
  const terms = new Map(records.map(record => [record.id, diversityTerms(`${record.title ?? ''} ${record.content}`)]));
  const relevance = (record: ContextPackRecordInput): number => {
    if (record.score === undefined) return 0;
    if (maxScore === minScore) return 1;
    return (record.score - minScore) / (maxScore - minScore);
  };
  const remaining = records.slice();
  const selected: ContextPackRecordInput[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateTerms = terms.get(candidate.id) ?? new Set<string>();
      const redundancy = selected.length === 0
        ? 0
        : Math.max(...selected.map(record => lexicalSimilarity(candidateTerms, terms.get(record.id) ?? new Set<string>())));
      const value = lambda * relevance(candidate) - (1 - lambda) * redundancy;
      if (value > bestValue || (value === bestValue && compareStable(candidate, remaining[bestIndex]) < 0)) {
        bestIndex = index;
        bestValue = value;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

/**
 * Pack query results into a deterministic, JSON-safe ContextPack.
 *
 * The estimator is injectable so callers can use the tokenizer of the target
 * model. Equal input and equal deterministic estimator produce byte-stable
 * output; no clock, random id, or filesystem is consulted.
 */
export function packContext(input: ContextPackInput, options: PackContextOptions = {}): ContextPack {
  const omissions: ContextPackOmission[] = [];
  const estimator = options.tokenEstimator ?? DEFAULT_TOKEN_ESTIMATOR;
  const requestedTokens = clampBudget(options.budget ?? options.tokenBudget ?? input.budget ?? input.tokenBudget);
  const maxRecords = options.maxRecords === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(options.maxRecords));
  const maxEvidence = options.maxEvidencePerRecord === undefined
    ? DEFAULT_MAX_EVIDENCE_PER_RECORD
    : Math.max(0, Math.floor(options.maxEvidencePerRecord));
  const diversityLambda = clampDiversityLambda(options.diversityLambda);

  const sourceRecords = normalizeRecords(Array.isArray(input.records) ? input.records : [], omissions, estimator);
  const provenance = input.provenance ? canonicalJson(input.provenance) as Record<string, ContextPackJsonValue> : {};
  const records = orderRecords(sourceRecords, diversityLambda).slice(0, maxRecords);
  for (const record of sourceRecords.filter(source => !records.some(record => record.id === source.id))) {
    addOmission(omissions, 'record', record.id, 'budget', estimateWith(estimator, record.content));
  }
  const allEvidence = normalizeEvidence(input.evidence, records, omissions, maxEvidence, estimator);

  const originalQuery = normalizedText(input.query);
  let query = originalQuery;
  let outputRecords: ContextPackRecord[] = [];
  let outputEvidence: ContextPackEvidence[] = [];
  let text = renderPack(query, outputRecords, outputEvidence, provenance);
  let usedTokens = estimateWith(estimator, text);
  // Explicit max-* limits and normalization budget limits are omissions too,
  // so surface them as truncation even when the textual token budget fits.
  let truncated = omissions.some(item => item.reason === 'budget');

  if (usedTokens > requestedTokens) {
    const queryBudget = Math.max(0, requestedTokens - estimateWith(estimator, 'Query: '));
    query = truncateToTokens(originalQuery, queryBudget, estimator);
    truncated = query !== originalQuery;
    text = renderPack(query, outputRecords, outputEvidence, provenance);
    usedTokens = estimateWith(estimator, text);
    if (query !== originalQuery) addOmission(omissions, 'query', 'query', 'budget', estimateWith(estimator, originalQuery));
    // The fixed "Query: " label itself costs two estimated tokens. For a
    // zero/one-token budget, emit an empty text payload so the hard budget is
    // still respected rather than returning an over-budget header.
    if (estimateWith(estimator, renderPack(query, outputRecords, outputEvidence, provenance)) > requestedTokens) {
      if (originalQuery && !omissions.some(item => item.kind === 'query')) {
        addOmission(omissions, 'query', 'query', 'budget', estimateWith(estimator, originalQuery));
      }
      query = '';
      text = '';
      usedTokens = 0;
    }
  }

  const canFit = (nextText: string) => estimateWith(estimator, nextText) <= requestedTokens;
  for (const record of records) {
    const full = outputRecord(record, record.content, false);
    const candidateText = renderPack(query, [...outputRecords, full], outputEvidence, provenance);
    if (canFit(candidateText)) {
      outputRecords.push(full);
      text = candidateText;
      usedTokens = estimateWith(estimator, text);
      continue;
    }
    const currentTokens = estimateWith(estimator, renderPack(query, outputRecords, outputEvidence, provenance));
    const remaining = Math.max(0, requestedTokens - currentTokens);
    const prefix = outputRecord(record, '', false);
    const prefixTokens = estimateWith(estimator, renderPack(query, [...outputRecords, prefix], outputEvidence, provenance));
    const contentBudget = Math.max(0, remaining - Math.max(0, prefixTokens - currentTokens));
    const clipped = truncateToTokens(record.content, contentBudget, estimator);
    const clippedRecord = outputRecord(record, clipped, clipped !== record.content);
    const clippedText = renderPack(query, [...outputRecords, clippedRecord], outputEvidence, provenance);
    if (clipped && canFit(clippedText)) {
      outputRecords.push(clippedRecord);
      text = clippedText;
      usedTokens = estimateWith(estimator, text);
      truncated = true;
      continue;
    }
    addOmission(omissions, 'record', record.id, 'budget', estimateWith(estimator, record.content));
    truncated = true;
  }

  for (const evidence of allEvidence) {
    if (!outputRecords.some(record => record.id === evidence.recordId)) {
      addOmission(omissions, 'evidence', evidence.id, 'budget', estimateWith(estimator, evidence.content));
      truncated = true;
      continue;
    }
    const full = toOutputEvidence(evidence, evidence.content, false);
    const candidateText = renderPack(query, outputRecords, [...outputEvidence, full], provenance);
    if (canFit(candidateText)) {
      outputEvidence.push(full);
      text = candidateText;
      usedTokens = estimateWith(estimator, text);
      continue;
    }
    const currentTokens = estimateWith(estimator, renderPack(query, outputRecords, outputEvidence, provenance));
    const remaining = Math.max(0, requestedTokens - currentTokens);
    const prefix = toOutputEvidence(evidence, '', false);
    const prefixTokens = estimateWith(estimator, renderPack(query, outputRecords, [...outputEvidence, prefix], provenance));
    const contentBudget = Math.max(0, remaining - Math.max(0, prefixTokens - currentTokens));
    const clipped = truncateToTokens(evidence.content, contentBudget, estimator);
    const clippedEvidence = toOutputEvidence(evidence, clipped, clipped !== evidence.content);
    const clippedText = renderPack(query, outputRecords, [...outputEvidence, clippedEvidence], provenance);
    if (clipped && canFit(clippedText)) {
      outputEvidence.push(clippedEvidence);
      text = clippedText;
      usedTokens = estimateWith(estimator, text);
      truncated = true;
      continue;
    }
    addOmission(omissions, 'evidence', evidence.id, 'budget', estimateWith(estimator, evidence.content));
    truncated = true;
  }

  // Keep all diagnostic arrays deterministic, including normalization omissions.
  const omittedEvidenceIds = omissions.filter(item => item.kind === 'evidence').map(item => item.id);
  const diagnostics = {
    truncated,
    omissions: omissions.slice(),
    omittedRecordIds: omissions.filter(item => item.kind === 'record').map(item => item.id),
    omittedEvidenceIds,
    omittedEvidenceCount: omittedEvidenceIds.length,
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
