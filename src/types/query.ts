import type { GraphNode } from './graph';

export interface RecallResult {
  project: string;
  stage?: string;
  focus: string;
  state: string[];
  next: string;
  mustRead: string[];
  dirty_flags_count?: number;
  recent_updates?: Array<{ action: string; summary: string | null; created_at: string }>;
  active_modules?: string[];
  active_foundation?: string[];
  recent_traces?: Array<{
    id: string;
    title: string;
    summary: string;
    file_path: string;
    created_at: string;
    changed_files: string[];
    decisions: string[];
    architecture_notes: string[];
    next: string[];
  }>;
  architecture?: Array<{
    id: string;
    title: string;
    summary: string | null;
    file_path: string;
    source_files: string[];
  }>;
  decisions?: Array<{
    id: string;
    title: string;
    summary: string | null;
    file_path: string;
  }>;
  context_summary?: string[];
}

export type MatchType = 'exact_id' | 'exact_title' | 'alias' | 'tag' | 'graph_expansion' | 'keyword_fallback';

export interface AskMatch {
  node: GraphNode;
  matchType: MatchType;
  confidence: number;
  graphDistance?: number;
}

export interface AskResult {
  query: string;
  matches: AskMatch[];
  recommendedRead: string[];
  evidencePaths: string[];
}

export interface ContextCardInfo {
  id: string;
  title: string;
  file_path: string;
  summary?: string;
  type: string;
  score?: number;
  reason?: string;
  stale?: boolean;
}

export interface ContextQueryResult {
  task: string;
  project_name?: string;
  project_stage?: string;
  current_focus: string;
  must_read: Array<{ path: string; reason: string }>;
  relevant_memory: ContextCardInfo[];
  changed_files: Array<{ path: string; status: string }>;
  dirty_memory: string[];
  warnings: string[];
  recommended_next_action: string;
  current_architecture?: string[];
  recent_session_memory?: string[];
  relevant_decisions?: string[];
}
