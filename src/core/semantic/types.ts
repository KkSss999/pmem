import type Database from 'better-sqlite3';
import type { CardFrontmatter, SemanticChunkRow } from '../../types';

export const DEFAULT_MAX_MODEL_TOKENS = 512;
export const DEFAULT_CHUNK_TOKEN_BUDGET = 480;
export const SEMANTIC_PIPELINE_VERSION = 2;

export interface SemanticCardDocument {
  id: string;
  type?: string | null;
  status?: string | null;
  title: string;
  summary?: string | null;
  body: string;
  aliases?: readonly string[];
  tags?: readonly string[];
  sourceFiles?: readonly string[];
  relatedCardIds?: readonly string[];
  frontmatter?: Pick<CardFrontmatter, 'trust_label' | 'sensitivity' | 'superseded_by'>;
  isCandidate?: boolean;
  isDeleted?: boolean;
}

export interface SemanticChunk {
  chunkId: string;
  cardId: string;
  heading: string | null;
  headingPath: string[];
  ordinal: number;
  content: string;
  contentHash: string;
  /** Local second-stage metadata; deliberately not sent to the embedding provider. */
  context: string;
  contextHash: string;
  /** Conservative UTF-8 byte upper bound used before the model tokenizer exists. */
  estimatedTokens: number;
}

export interface ChunkingOptions {
  /** Must not exceed the embedding model's context ceiling. */
  maxTokens?: number;
  /** Reserve space for provider-added special tokens. */
  reservedTokens?: number;
}

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly revision: string;
  readonly dimension: number;
  /** Raw passages; the provider owns the model-specific `passage: ` prefix. */
  embedPassages(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  /** Raw query; the provider owns the model-specific `query: ` prefix. */
  embedQuery(text: string): Promise<readonly number[]>;
}

export interface SemanticIndexOptions extends ChunkingOptions {
  mode: 'full' | 'incremental';
  batchSize?: number;
  now?: () => Date;
  beforeCommit?: () => void;
}

export interface SemanticIndexResult {
  mode: 'full' | 'incremental';
  cardsSeen: number;
  cardsExcluded: number;
  chunksTotal: number;
  chunksEmbedded: number;
  chunksReused: number;
  chunksDeleted: number;
  indexContentHash: string;
}

export interface SemanticStatus {
  available: boolean;
  pipelineVersion: number | null;
  compatible: boolean;
  modelId: string | null;
  revision: string | null;
  dimension: number | null;
  cardCount: number;
  chunkCount: number;
  indexContentHash: string | null;
  builtAt: string | null;
}

export interface SemanticProjectStatus extends SemanticStatus {
  cardCount: number;
}

export type SemanticDatabase = Database.Database;

export interface SemanticChunkMatch extends SemanticChunkRow {
  similarity: number;
}

export interface SemanticCardMatch {
  cardId: string;
  chunkId: string;
  heading: string | null;
  headingPath: string[];
  content: string;
  context: string;
  similarity: number;
  modelId: string;
  modelRevision: string;
}

export type SemanticAbstentionReason =
  | 'index_unavailable'
  | 'no_positive_similarity'
  | 'below_absolute_floor'
  | 'flat_score_distribution';

export interface SemanticSearchDiagnostics {
  rawChunkCount: number;
  rawCardCount: number;
  acceptedCardCount: number;
  topSimilarity: number | null;
  medianSimilarity: number | null;
  runnerUpSimilarity: number | null;
  cutoff: number | null;
  abstainedReason: SemanticAbstentionReason | null;
}

export interface SemanticCardSearchResult {
  matches: SemanticCardMatch[];
  diagnostics: SemanticSearchDiagnostics;
}

export interface SemanticProjectRebuildOptions extends ChunkingOptions {
  mode: 'full' | 'incremental';
  batchSize?: number;
  now?: () => Date;
}
