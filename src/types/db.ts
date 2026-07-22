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
