import * as path from 'path';
import { fileExists, readFile } from '../fs';
import type Database from 'better-sqlite3';
import { openDatabase, createSchema } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import { parseIntent } from './engine/intent';
import { buildQueryPlan } from './engine/queryPlan';
import { rerankCandidates, type RerankExplanation } from './engine/rerank';
import { generateCandidates } from './engine/candidates';
import { CHANNEL_BASE, fuseAndScore, type ScoredCandidate, type ScoredResult, type Reason, type ScoreFactors } from './engine/scoring';
import {
  getSemanticStatus,
  loadSemanticProjectDocuments,
  searchSemanticCardsDetailed,
  type EmbeddingProvider,
  type SemanticCardMatch,
  type SemanticSearchDiagnostics,
} from '../semantic';
import { summarizeSemanticEligibility } from '../health/semantic';

// Legacy match_type retained for AskResultV03 back-compat.
type MatchType = 'exact_id' | 'exact_title' | 'alias' | 'tag' | 'source_file' | 'graph_expansion' | 'keyword_fallback' | 'type_filter';

export interface AskMatchV03 {
  id: string;
  title: string;
  match_type: MatchType;
  confidence: number;
  graph_distance: number;
  file: string;
  edge_type?: string;
  from_card?: string;
  // v0.8 additions (optional, additive only)
  score?: number;
  reasons?: Reason[];
  factors?: ScoreFactors;
  stale?: boolean;
  // v1.1 agent-trust display fields (optional, additive only)
  card_confidence?: number | null;
  superseded_by?: string | null;
  classification?: string | null;
  /** Present in explain mode when the local contextual second stage ran. */
  rerank?: RerankExplanation;
  /** Additive content-level recall fields. */
  summary?: string;
  snippet?: string;
}

export interface AskResultV03 {
  query: string;
  matched: AskMatchV03[];
  recommended_files: string[];
  evidence_paths: string[];
  /** Present only when explicitly enabled semantic retrieval degraded safely. */
  warnings?: string[];
  /** Additive diagnostics emitted for --explain and every zero-result response. */
  diagnostics?: AskDiagnosticsV03;
  /** Present only for an inventory-style type browse; additive and complete. */
  browse?: { type: string; total: number; complete: true };
}

export type AskNoResultReason =
  | 'project_empty'
  | 'semantic_all_cards_excluded'
  | 'semantic_below_relevance_threshold'
  | 'semantic_index_unavailable'
  | 'no_channel_match';

export interface AskDiagnosticsV03 {
  card_count: number;
  deterministic_candidate_count: number;
  no_result_reason: AskNoResultReason | null;
  semantic: {
    enabled: boolean;
    index_available: boolean;
    indexed_cards: number;
    indexed_chunks: number;
    eligible_cards: number;
    excluded_cards: number;
    excluded_by_reason: Record<string, number>;
    excluded_by_trust_detail: Record<string, number>;
    raw_chunk_hits: number;
    raw_card_hits: number;
    accepted_card_hits: number;
    top_similarity: number | null;
    median_similarity: number | null;
    runner_up_similarity: number | null;
    cutoff: number | null;
    abstained_reason: string | null;
  };
}

export interface AskOptions {
  limit?: number;
  explain?: boolean;
  /** injected for deterministic tests; defaults to Date.now() at entry */
  now?: number;
  /** Evaluation/SDK escape hatch; semantic retrieval reranks by default. */
  rerank?: boolean;
}

const CHANNEL_TO_MATCH_TYPE: Record<string, MatchType> = {
  exact_id: 'exact_id',
  id_substring: 'exact_title',
  exact_title: 'exact_title',
  title_phrase: 'exact_title',
  title_token: 'exact_title',
  alias: 'alias',
  tag: 'tag',
  tag_token: 'tag',
  source_file: 'source_file',
  source_file_prefix: 'source_file',
  fts: 'keyword_fallback',
  like: 'keyword_fallback',
  graph: 'graph_expansion',
};

export function askQuery(pmemPath: string, query: string, options: AskOptions & { db?: Database.Database } = {}): AskResultV03 {
  return executeAskQuery(pmemPath, query, options);
}

/**
 * Async semantic path used by the Runtime/CLI. The synchronous askQuery API
 * remains deterministic and backward-compatible for embedders and tests.
 */
export async function askQueryWithSemantic(
  pmemPath: string,
  query: string,
  provider: EmbeddingProvider,
  options: AskOptions & { db?: Database.Database } = {},
): Promise<AskResultV03> {
  const db = options.db ?? openDatabase(pmemPath);
  if (!options.db) createSchema(db);
  try {
    const status = getSemanticStatus(db);
    if (!status.available) {
      const detail = status.compatible
        ? 'the derived index is unavailable'
        : `the derived index uses pipeline v${status.pipelineVersion ?? 1}, but v2 is required`;
      return {
        ...executeAskQuery(pmemPath, query, { ...options, db }),
        warnings: [`Semantic retrieval is enabled but ${detail}. Run \`pmem semantic rebuild\`.`],
      };
    }
    const search = await searchSemanticCardsDetailed(db, query, provider, 48);
    return executeAskQuery(pmemPath, query, { ...options, db }, search.matches, options.rerank !== false, search.diagnostics);
  } catch (error: any) {
    return {
      ...executeAskQuery(pmemPath, query, { ...options, db }),
      warnings: [`Semantic retrieval degraded to deterministic recall: ${error?.message ?? String(error)}`],
    };
  }
}

function executeAskQuery(
  pmemPath: string,
  query: string,
  options: AskOptions & { db?: Database.Database },
  semanticMatches: readonly SemanticCardMatch[] = [],
  rerankEnabled = false,
  semanticSearch?: SemanticSearchDiagnostics,
): AskResultV03 {
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }

  const db = options.db ?? openDatabase(pmemPath);
  if (!options.db) createSchema(db);

  const manifest = loadManifest(pmemPath);
  const config = manifest
    ? resolveConfig(manifest)
    : { evidence_types: ['decision', 'trace'], card_types: ['module', 'decision', 'trace', 'task', 'feature', 'risk'] };
  const configuredTypes: string[] = (config as any).card_types ?? ['module', 'decision', 'trace', 'task', 'feature', 'risk'];
  // Custom domain cards may exist in the index even when an older manifest did
  // not declare them. Include indexed types so enumeration remains useful
  // without changing the manifest or the write-side schema.
  const indexedTypes = (db.prepare(
    'SELECT DISTINCT type FROM cards WHERE is_deleted = 0 AND is_candidate = 0 ORDER BY type'
  ).all() as Array<{ type: string }>).map(row => row.type);
  const knownTypes = [...new Set([...configuredTypes, ...indexedTypes])];

  const intent = parseIntent(query, knownTypes);
  if (intent.enumeration && intent.typeHints.length === 1) {
    return executeTypeBrowse(pmemPath, db, query, intent.typeHints[0], options, config);
  }
  const candidates = generateCandidates(db, intent, {
    additionalCandidates: semanticCandidates(db, semanticMatches),
  });
  const deterministicCandidateCount = new Set(candidates.filter(candidate =>
    candidate.reasons.some(reason => reason.channel !== 'semantic' && reason.channel !== 'graph')
  ).map(candidate => candidate.card.id)).size;

  const dirtyRows = db.prepare(
    "SELECT target FROM dirty_flags WHERE resolved_at IS NULL AND scope = 'card'"
  ).all() as Array<{ target: string }>;
  const dirtyCardIds = new Set(dirtyRows.map(r => r.target));

  const scoredAll = fuseAndScore(candidates, {
    now: options.now ?? Date.now(),
    dirtyCardIds,
  });
  // v1.1: never surface secret-sensitivity cards in ask output.
  const visible = scoredAll.filter(r => (r.card as any).sensitivity !== 'secret');
  const scored = rerankEnabled ? rerankCandidates(visible, buildQueryPlan(intent)) : visible;

  const limit = options.limit ?? 20;
  const top = scored.slice(0, limit);

  const matched: AskMatchV03[] = top.map(r => toMatch(r, options.explain ?? false, db, pmemPath, intent.tokens));

  const recommendedFiles = top.slice(0, 8).map(r => r.card.file_path);

  const evidenceTypes: string[] = (config as any).evidence_types ?? ['decision', 'trace'];
  const evidencePaths = scored
    .filter(r => evidenceTypes.includes(r.card.type))
    .map(r => r.card.file_path);

  const result: AskResultV03 = {
    query,
    matched,
    recommended_files: recommendedFiles,
    evidence_paths: evidencePaths,
  };
  if (options.explain || matched.length === 0) {
    const cardCount = (db.prepare('SELECT COUNT(*) AS count FROM cards WHERE is_deleted = 0 AND is_candidate = 0').get() as { count: number }).count;
    const semanticStatus = getSemanticStatus(db);
    const embeddingEnabled = !!(manifest && 'embedding' in manifest && manifest.embedding.enabled);
    const eligibility = embeddingEnabled
      ? summarizeSemanticEligibility(loadSemanticProjectDocuments(pmemPath))
      : { eligible_cards: 0, excluded_cards: 0, excluded_by_reason: {}, excluded_by_trust_detail: {} };
    const noResultReason: AskNoResultReason | null = matched.length > 0 ? null
      : cardCount === 0 ? 'project_empty'
      : embeddingEnabled && eligibility.eligible_cards === 0 && eligibility.excluded_cards > 0
        ? 'semantic_all_cards_excluded'
        : embeddingEnabled && semanticSearch?.abstainedReason
          && semanticSearch.abstainedReason !== 'index_unavailable'
          && semanticSearch.abstainedReason !== 'no_positive_similarity'
          ? 'semantic_below_relevance_threshold'
          : embeddingEnabled && !semanticStatus.available ? 'semantic_index_unavailable'
          : 'no_channel_match';
    result.diagnostics = {
      card_count: cardCount,
      deterministic_candidate_count: deterministicCandidateCount,
      no_result_reason: noResultReason,
      semantic: {
        enabled: embeddingEnabled,
        index_available: semanticStatus.available,
        indexed_cards: semanticStatus.cardCount,
        indexed_chunks: semanticStatus.chunkCount,
        eligible_cards: eligibility.eligible_cards,
        excluded_cards: eligibility.excluded_cards,
        excluded_by_reason: eligibility.excluded_by_reason,
        excluded_by_trust_detail: eligibility.excluded_by_trust_detail,
        raw_chunk_hits: semanticSearch?.rawChunkCount ?? 0,
        raw_card_hits: semanticSearch?.rawCardCount ?? 0,
        accepted_card_hits: semanticSearch?.acceptedCardCount ?? 0,
        top_similarity: semanticSearch?.topSimilarity ?? null,
        median_similarity: semanticSearch?.medianSimilarity ?? null,
        runner_up_similarity: semanticSearch?.runnerUpSimilarity ?? null,
        cutoff: semanticSearch?.cutoff ?? null,
        abstained_reason: semanticSearch?.abstainedReason ?? null,
      },
    };
  }
  return result;
}

function executeTypeBrowse(
  pmemPath: string,
  db: Database.Database,
  query: string,
  type: string,
  options: AskOptions & { db?: Database.Database },
  config: any,
): AskResultV03 {
  const cards = db.prepare(
    `SELECT * FROM cards
     WHERE type = ? AND is_deleted = 0 AND is_candidate = 0
       AND COALESCE(sensitivity, '') <> 'secret'
     ORDER BY id ASC`
  ).all(type) as import('../../types').CardRow[];
  const matched = cards.map(card => {
    const match = toMatch({
      card,
      base: 1,
      score: 1,
      factors: { type_weight: 1, recency: 1, staleness: 1, status: 1, confidence: 1, superseded: 1 },
      stale: false,
      graph_distance: 0,
      reasons: [{ channel: 'like', detail: `type = ${type}`, base: 1 }],
    }, options.explain ?? false, db, pmemPath, []);
    match.match_type = 'type_filter';
    return match;
  });
  const evidenceTypes: string[] = (config as any).evidence_types ?? ['decision', 'trace'];
  return {
    query,
    matched,
    recommended_files: cards.map(card => card.file_path),
    evidence_paths: cards.filter(card => evidenceTypes.includes(card.type)).map(card => card.file_path),
    browse: { type, total: cards.length, complete: true },
  };
}

function semanticCandidates(db: Database.Database, matches: readonly SemanticCardMatch[]): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const cardQuery = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0 AND is_candidate = 0');
  for (const match of matches) {
    const card = cardQuery.get(match.cardId) as import('../../types').CardRow | undefined;
    if (!card || card.sensitivity === 'secret') continue;
    const base = Math.max(0.2, Math.min(CHANNEL_BASE.semantic, match.similarity));
    candidates.push({
      card,
      base,
      graph_distance: 0,
      reasons: [{
        channel: 'semantic',
        detail: `cosine ${match.similarity.toFixed(4)} at ${match.headingPath.join(' > ') || '(card root)'}`,
        base,
        similarity: match.similarity,
        chunk_id: match.chunkId,
        heading: match.heading,
        model_revision: match.modelRevision,
        parent_card: match.cardId,
      }],
      rerank_text: `${match.content}\n${match.context}`,
    });
  }
  return candidates;
}

function toMatch(
  r: ScoredResult,
  explain: boolean,
  db?: Database.Database,
  pmemPath?: string,
  queryTokens: string[] = [],
): AskMatchV03 {
  const primary = [...r.reasons].sort((a, b) => b.base - a.base)[0];
  const match: AskMatchV03 = {
    id: r.card.id,
    title: r.card.title,
    match_type: CHANNEL_TO_MATCH_TYPE[primary?.channel ?? 'like'] ?? 'keyword_fallback',
    confidence: r.score,
    graph_distance: r.graph_distance,
    file: r.card.file_path,
    score: r.score,
    stale: r.stale,
  };
  const summary = sanitizeContent(r.card.summary ?? '');
  if (summary) match.summary = summary;
  if (db && pmemPath) {
    const snippet = readCardSnippet(db, pmemPath, r.card, queryTokens);
    if (snippet) match.snippet = snippet;
  }
  if (r.edge_type) match.edge_type = r.edge_type;
  if (r.from_card) match.from_card = r.from_card;
  const cardConfidence = (r.card as any).confidence;
  if (cardConfidence != null) match.card_confidence = cardConfidence;
  const cardSuperseded = (r.card as any).superseded_by;
  if (cardSuperseded) match.superseded_by = cardSuperseded;
  const cardClassification = (r.card as any).classification;
  if (cardClassification) match.classification = cardClassification;
  if (explain) {
    match.reasons = r.reasons;
    match.factors = r.factors;
    if (r.rerank) match.rerank = r.rerank;
  }
  return match;
}

const SENSITIVE_VALUE_RE = /(\b(?:api[-_ ]?key|secret(?:[-_ ]?key)?|password|passwd|token|authorization|bearer)\s*[:=]\s*["'`]?)([^\s,;"'`]+)/gi;
const KNOWN_TOKEN_RE = /\b(?:sk|rk)-[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b/g;

function sanitizeContent(value: string): string {
  return value
    .replace(SENSITIVE_VALUE_RE, '$1[REDACTED]')
    .replace(KNOWN_TOKEN_RE, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readCardSnippet(
  db: Database.Database,
  pmemPath: string,
  card: import('../../types').CardRow,
  queryTokens: string[],
): string | undefined {
  if (card.sensitivity === 'secret') return undefined;
  let body = '';
  try {
    const row = db.prepare('SELECT body FROM card_fts WHERE card_id = ? LIMIT 1').get(card.id) as { body?: string } | undefined;
    body = row?.body ?? '';
  } catch {
    // Older indexes may not have FTS; the Markdown card remains a safe fallback.
  }
  if (!body && card.file_path) {
    const projectRoot = path.resolve(pmemPath, '..');
    const filePath = path.resolve(projectRoot, card.file_path);
    const pmemRoot = path.resolve(pmemPath);
    if (filePath.startsWith(pmemRoot + path.sep)) {
      body = readFile(filePath) ?? '';
      body = body.replace(/^---\n[\s\S]*?\n---\n?/, '');
    }
  }
  const paragraphs = body
    .split(/\n\s*\n/)
    .map(part => sanitizeContent(part.replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '')))
    .filter(Boolean);
  if (paragraphs.length === 0) return undefined;
  const terms = queryTokens.filter(token => token.length > 1 || /[一-鿿]/.test(token));
  const lowerTerms = terms.map(term => term.toLowerCase());
  const contentParagraphs = paragraphs.filter(paragraph => paragraph !== card.title);
  const relevant = contentParagraphs.find(paragraph => lowerTerms.some(term => paragraph.toLowerCase().includes(term)));
  const snippet = relevant ?? contentParagraphs[0] ?? paragraphs[0];
  return snippet.length > 420 ? `${snippet.slice(0, 417).trimEnd()}...` : snippet;
}
