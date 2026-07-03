import * as path from 'path';
import { fileExists } from '../fs';
import { openDatabase, createSchema } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import { parseIntent } from './engine/intent';
import { generateCandidates } from './engine/candidates';
import { fuseAndScore, type ScoredResult, type Reason, type ScoreFactors } from './engine/scoring';

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
}

export interface AskResultV03 {
  query: string;
  matched: AskMatchV03[];
  recommended_files: string[];
  evidence_paths: string[];
}

export interface AskOptions {
  limit?: number;
  explain?: boolean;
  /** injected for deterministic tests; defaults to Date.now() at entry */
  now?: number;
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

export function askQuery(pmemPath: string, query: string, options: AskOptions = {}): AskResultV03 {
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }

  const db = openDatabase(pmemPath);
  createSchema(db);

  const manifest = loadManifest(pmemPath);
  const config = manifest
    ? resolveConfig(manifest)
    : { evidence_types: ['decision', 'trace'], card_types: ['module', 'decision', 'trace', 'task', 'feature', 'risk'] };
  const knownTypes: string[] = (config as any).card_types ?? ['module', 'decision', 'trace', 'task', 'feature', 'risk'];

  const intent = parseIntent(query, knownTypes);
  const candidates = generateCandidates(db, intent);

  const dirtyRows = db.prepare(
    "SELECT target FROM dirty_flags WHERE resolved_at IS NULL AND scope = 'card'"
  ).all() as Array<{ target: string }>;
  const dirtyCardIds = new Set(dirtyRows.map(r => r.target));

  const scored = fuseAndScore(candidates, {
    now: options.now ?? Date.now(),
    dirtyCardIds,
  });

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
  if (explain) {
    match.reasons = r.reasons;
    match.factors = r.factors;
  }
  return match;
}
