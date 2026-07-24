export interface CardRow {
  id: string;
  type: string;
  title: string;
  status: string | null;
  priority: string | null;
  file_path: string;
  summary: string | null;
  schema_version: string | null;
  card_version: number;
  created_at: string | null;
  updated_at: string | null;
  last_verified_at: string | null;
  file_hash: string;
  frontmatter_hash: string;
  body_hash: string;
  token_count: number;
  section_count: number;
  is_deleted: number;
  is_candidate: number;
  /** v1.1: agent-trust fields persisted from frontmatter for query/scoring/filtering. */
  confidence?: number | null;
  /** Stored as a JSON array string in SQLite; array in the rebuild input. */
  superseded_by?: string[] | string | null;
  classification?: string | null;
  trust_label?: string | null;
  sensitivity?: string | null;
}

export interface EdgeRow {
  id?: number;
  from_id: string;
  to_id: string;
  type: string;
  source: 'explicit' | 'inferred' | 'mention';
  confidence: number;
  created_at?: string;
  updated_at?: string;
}

export interface DirtyFlagRow {
  id?: number;
  scope: string;
  target: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  session_id: string | null;
}

export interface SessionRow {
  id: string;
  agent_name: string | null;
  started_at: string;
  ended_at: string | null;
  task_summary: string | null;
  base_index_hash: string | null;
  status: string | null;
  dirty: number;
}

export interface UpdateLogRow {
  id?: number;
  action: string;
  summary: string | null;
  session_id: string | null;
  created_at: string;
  affected_cards: string | null;
  affected_paths: string | null;
  success: number;
  error: string | null;
}

/** Derived semantic-index metadata. Markdown cards remain the source of truth. */
export interface SemanticMetaRow {
  id: 1;
  /** Derived retrieval pipeline format. v2 adds contextual passage metadata. */
  pipeline_version: number;
  model_id: string;
  model_revision: string;
  dimension: number;
  index_content_hash: string;
  chunk_count: number;
  built_at: string;
}

/** A heading-aware card chunk and its normalized Float32 embedding. */
export interface SemanticChunkRow {
  chunk_id: string;
  card_id: string;
  heading: string | null;
  heading_path: string;
  ordinal: number;
  content: string;
  content_hash: string;
  context: string;
  context_hash: string;
  model_id: string;
  model_revision: string;
  dimension: number;
  vector: Buffer;
  created_at: string;
  updated_at: string;
}
