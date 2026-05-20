// === Core Card Types ===

export type NodeType =
  | 'project'
  | 'module'
  | 'feature'
  | 'task'
  | 'decision'
  | 'risk'
  | 'assumption'
  | 'constraint'
  | 'person'
  | 'resource'
  | 'file'
  | 'doc'
  | 'trace';

export type EdgeType =
  | 'depends_on'
  | 'blocks'
  | 'implements'
  | 'constrains'
  | 'decided_by'
  | 'derived_from'
  | 'related_to'
  | 'supersedes'
  | 'conflicts_with'
  | 'next_step_of';

export type NodeStatus = 'active' | 'designing' | 'implementing' | 'completed' | 'archived' | 'blocked';

export type CardPriority = 'high' | 'medium' | 'low';

export interface CardFrontmatter {
  id: string;
  type: NodeType;
  status?: NodeStatus;
  priority?: CardPriority;
  tags?: string[];
  aliases?: string[];
  schema_version?: string;
  version?: number;
  related?: string[];
  depends_on?: string[];
  updated?: string;
  last_verified?: string;
  freshness?: {
    ttl: string;
    policy: string;
  };
  source_files?: string[];
}

export interface MemoryCard {
  frontmatter: CardFrontmatter;
  body: string;
  filePath: string;
}

// === Graph Index Types ===

export interface GraphNode {
  id: string;
  type: NodeType;
  title: string;
  status?: NodeStatus;
  file: string;
  tags?: string[];
  aliases?: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence?: number;
  derived?: boolean;
}

export interface GraphIndex {
  kind: 'pmem.graph_index';
  pmem_version: string;
  generated_at: string;
  source: {
    type: 'markdown_frontmatter';
    glob: string;
    source_hash: string;
  };
  node_count: number;
  edge_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// === Manifest Types ===

export interface ManifestProject {
  name: string;
  language?: string;
  status?: string;
}

export interface ManifestSourceOfTruth {
  type: 'markdown_cards';
  path: string;
  card_globs: string[];
}

export interface ManifestIndexes {
  path: string;
  generated: boolean;
  graph: {
    mode: 'single' | 'sharded';
    path: string;
  };
  keyword?: {
    mode: 'bm25';
    path: string;
  };
  hashes?: {
    path: string;
  };
}

export interface ManifestAutoUpdate {
  enabled: boolean;
  on_code_change: 'mark_dirty' | 'ignore';
  on_doc_change: 'mark_dirty' | 'ignore';
  on_memory_change: 'rebuild_indexes' | 'ignore';
  on_session_end: 'prompt' | 'ignore';
  on_git_commit: 'suggest_trace' | 'ignore';
  min_trace_interval: string;
  max_auto_traces_per_day: number;
  ignore_patterns: string[];
  trace_policy: {
    require_meaningful_change: boolean;
    require_summary: boolean;
    require_related_node: boolean;
  };
}

export interface ManifestIntegration {
  template_version: string;
  files: string[];
  hooks?: Record<string, string>;
}

export interface Manifest {
  pmem: SchemaVersion;
  project: ManifestProject;
  source_of_truth: ManifestSourceOfTruth;
  indexes: ManifestIndexes;
  auto_update: ManifestAutoUpdate;
  freshness: {
    default_ttl: string;
    stale_on_related_code_change: boolean;
    require_last_verified: boolean;
  };
  integrations: {
    active: string[];
    [key: string]: ManifestIntegration | string[] | undefined;
  };
  memory_status: MemoryStatus;
  card_policy: CardPolicy;
  concurrency: ConcurrencyConfig;
  distill: DistillConfig;
  migrations: { applied: MigrationRecord[] };
}

// === Recall Types ===

export interface RecallResult {
  project: string;
  stage?: string;
  focus: string;
  state: string[];
  next: string;
  mustRead: string[];
}

// === Ask Types ===

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

// === Verify Types ===

export interface VerifyIssue {
  severity: 'error' | 'warning';
  type: string;
  message: string;
  fix: string;
}

export interface VerifyResult {
  passed: boolean;
  score: number;
  issues: VerifyIssue[];
}

// === v0.2 Schema & Version Types ===

export type MemoryCompleteness = 'incomplete' | 'partial' | 'usable' | 'mature';
export type InitMode = 'minimal' | 'guided' | 'from_manifest' | 'imported';

export interface MemoryStatus {
  completeness: MemoryCompleteness;
  initialized_mode: InitMode;
  dirty: boolean;
  dirty_since: string | null;
  dirty_reason: string | null;
}

export interface SchemaVersion {
  schema_version: string;
  protocol_version: string;
  created_by: string;
  last_migrated_by: string | null;
}

export interface CardPolicy {
  id_pattern: string;
  max_tokens: Record<string, number>;
  max_sections: Record<string, number>;
  warn_when_related_count_gt: number;
}

export interface ConcurrencyLockConfig {
  enabled: boolean;
  path: string;
  timeout: string;
  stale_after: string;
  on_timeout: 'abort' | 'wait' | 'readonly';
}

export interface ConcurrencyConfig {
  mode: 'file-basic';
  atomic_write: boolean;
  lock: ConcurrencyLockConfig;
  optimistic_lock: {
    enabled: boolean;
    note: string;
  };
}

export interface MigrationRecord {
  id: string;
  applied_at: string;
  cli_version: string;
}

export interface DistillConfig {
  enabled: boolean;
  cadence: 'daily' | 'weekly';
  max_undistilled_traces: number;
  require_confirmation: boolean;
  suggest_card_splits: boolean;
}

export interface InitScanCandidate {
  suggestedId: string;
  path: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface InitScanResult {
  stack: string[];
  sourceDirectories: string[];
  candidates: InitScanCandidate[];
}
