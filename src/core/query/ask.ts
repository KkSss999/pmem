import * as path from 'path';
import { fileExists } from '../fs';
import type Database from 'better-sqlite3';
import { openDatabase, createSchema } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import { parseIntent } from './engine/intent';
import { buildQueryPlan } from './engine/queryPlan';
import { rerankCandidates, type RerankExplanation } from './engine/rerank';
import { generateCandidates } from './engine/candidates';
import { CHANNEL_BASE, fuseAndScore, type ScoredCandidate, type ScoredResult, type Reason, type ScoreFactors } from './engine/scoring';
import { getSemanticStatus, searchSemanticCards, type EmbeddingProvider, type SemanticCardMatch } from '../semantic';

// Legacy match_type retained for AskResultV03 back-compat.
type MatchType = 'exact_id' | 'exact_title' | 'alias' | 'tag' | 'source_file' | 'graph_expansion' | 'keyword_fallback';

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
}

export interface AskResultV03 {
  query: string;
  matched: AskMatchV03[];
  recommended_files: string[];
  evidence_paths: string[];
  /** Present only when explicitly enabled semantic retrieval degraded safely. */
  warnings?: string[];
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
    const matches = await searchSemanticCards(db, query, provider, 48);
    return executeAskQuery(pmemPath, query, { ...options, db }, matches, options.rerank !== false);
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
  const knownTypes: string[] = (config as any).card_types ?? ['module', 'decision', 'trace', 'task', 'feature', 'risk'];

  const intent = parseIntent(query, knownTypes);
  const candidates = generateCandidates(db, intent, {
    additionalCandidates: semanticCandidates(db, semanticMatches),
  });

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

  const matched: AskMatchV03[] = top.map(r => toMatch(r, options.explain ?? false));

  const recommendedFiles = top.slice(0, 8).map(r => r.card.file_path);

  const evidenceTypes: string[] = (config as any).evidence_types ?? ['decision', 'trace'];
  const evidencePaths = scored
    .filter(r => evidenceTypes.includes(r.card.type))
    .map(r => r.card.file_path);

  return {
    query,
    matched,
    recommended_files: recommendedFiles,
    evidence_paths: evidencePaths,
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

function toMatch(r: ScoredResult, explain: boolean): AskMatchV03 {
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
