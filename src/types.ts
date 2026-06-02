// === Core Card Types ===

// v0.7.0: NodeType is now string (was a hardcoded union).
// Card type validation is done at runtime via manifest.schema.card_types.
// This change allows custom domain types (character, chapter, world, arc, ...).
export type NodeType = string;

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
  domain?: string;
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

// === v0.4 Manifest discriminated union ===

export type ManifestSchemaVersion = '0.2' | '0.3';

// Base fields shared by all manifest versions
export interface ManifestBase {
  pmem: {
    schema_version: ManifestSchemaVersion;
    protocol_version: string;
    created_by: string;
    last_migrated_by: string | null;
  };
  project: ManifestProject;
  source_of_truth: ManifestSourceOfTruth;
  memory_status: MemoryStatus;
  concurrency: ConcurrencyConfig;
  card_policy: CardPolicy;
  auto_update: ManifestAutoUpdate;
  freshness: {
    default_ttl: string;
    stale_on_related_code_change: boolean;
    require_last_verified: boolean;
  };
  distill: DistillConfig;
  integrations: {
    active: string[];
    [key: string]: ManifestIntegration | string[] | undefined;
  };
  migrations: { applied: MigrationRecord[] };
}

export interface ManifestV02 extends ManifestBase {
  pmem: ManifestBase['pmem'] & { schema_version: '0.2'; protocol_version: '0.2' };
  indexes: ManifestIndexes;
}

export type Manifest = ManifestV02 | ManifestV03;

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

// === v0.6.1 Consistency Types ===

export interface ConsistencyIssue {
  type: string;
  severity: 'blocking' | 'warning' | 'info';
  card_id?: string;
  file_path?: string;
  message: string;
}

// === v0.6.1 Suggestion Types ===

export interface AggregatedSuggestion {
  target: string;
  reason: string;
  matched_file: string | null;
  count: number;
  severity: 'blocking' | 'warning' | 'info';
  blocks_verify: boolean;
  is_duplicate: boolean;
  is_historical: boolean;
  created_at_first: string;
  created_at_last: string;
  sources: Array<{
    scope: string;
    target: string;
    reason: string;
    created_at: string;
    session_id: string | null;
  }>;
  /**
   * For inferred-edge suggestions: the DB ids of the edges in this group.
   * Pass these to `pmem update --confirm --accept-edges <ids>` or `--reject-edges <ids>`.
   */
  edge_ids?: number[];
  /**
   * For inferred-edge suggestions: the edge tuple (from_id → to_id) for readability.
   */
  edge_tuple?: string;
}

export interface SuggestSummary {
  affected_cards: number;
  blocking: number;
  warning: number;
  info: number;
  duplicates_hidden: number;
  historical_hidden: number;
  verify_blocking: boolean;
}

export interface SuggestGroups {
  blocking_for_verify: AggregatedSuggestion[];
  current_suggestions: AggregatedSuggestion[];
  historical_dirty_flags: AggregatedSuggestion[];
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
  // v0.7.0: card types that trace cards can be merged into.
  // Defaults to v0.6.4 list ['module','decision','task','feature'] when absent.
  merge_target_types?: string[];
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

// === v0.3 Runtime Config Types ===

export interface RuntimeConfig {
  mode: 'sqlite';
  db_path: string;
  markdown_source: boolean;
}

export interface RebuildHashConfig {
  file_hash: boolean;
  frontmatter_hash: boolean;
  body_hash: boolean;
}

export interface RebuildConfig {
  strategy: 'content_hash';
  hash: RebuildHashConfig;
}

export interface CliConfig {
  default_format: 'compact' | 'json' | 'paths' | 'pack';
  supported_formats: string[];
  default_budget: number;
}

export interface EmbeddingConfig {
  enabled: boolean;
  provider: 'none' | 'api' | 'local';
  model: string | null;
  dimension: number | null;
  store: 'sqlite';
  index: 'none';
}

export interface ServeExperimentalConfig {
  mcp: boolean;
  rest: boolean;
}

export interface ServeConfig {
  enabled: boolean;
  mode: 'none';
  experimental: ServeExperimentalConfig;
}

export interface LegacyJsonConfig {
  enabled: boolean;
  retained: boolean;
  path: string;
}

export interface IndexesConfigV03 {
  primary: 'sqlite';
  legacy_json: LegacyJsonConfig;
}

export interface ManifestChangeDetectionConfig {
  mtime_scan_dirs?: string[];
  skip_dirs?: string[];
}

export interface ManifestV03 extends ManifestBase {
  pmem: ManifestBase['pmem'] & { schema_version: '0.3'; protocol_version: '0.3' };
  runtime: RuntimeConfig;
  indexes: IndexesConfigV03;
  rebuild: RebuildConfig;
  cli: CliConfig;
  embedding: EmbeddingConfig;
  serve: ServeConfig;
  // v0.7.0: optional schema config for domain-specific card types.
  // Absent in v0.6.x projects — resolveConfig() falls back to v0.6.4 defaults.
  schema?: ManifestSchemaConfig;
  change_detection?: ManifestChangeDetectionConfig;
  discover?: { enabled: boolean };
}

// === v0.7.0 Domain Schema Types ===

export interface ManifestSchemaConfig {
  card_types?: string[];
  type_dirs?: Record<string, string>;
  foundational_types?: string[];
  evidence_types?: string[];
  default_type?: string;
  creatable_types?: string[];
}

export interface ResolvedConfig {
  card_types: string[];
  type_dirs: Record<string, string>;
  foundational_types: string[];
  evidence_types: string[];
  default_type: string;
  merge_target_types: string[];
  /** Types that `pmem new` will accept. Narrower than `card_types` to exclude
   *  internal compat types like 'integration' that exist for id_pattern but
   *  whose directories are excluded from rebuild. */
  creatable_types: string[];
}

// === v0.3 DB Row Types ===

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

export type CliFormat = 'compact' | 'json' | 'paths' | 'pack';

// === v0.6.3 Discover Types ===

export type DiscoverSource = 'source_import' | 'dependency_file';
export type DiscoveredLanguage = 'nodejs' | 'python' | 'rust' | 'go' | 'cpp' | 'java';

export interface ImportPattern {
  regex: string;
  confidence: number;
  scope: 'local' | 'external' | 'both';
}

export interface DependencyFilePattern {
  filename: string;
  parser: 'json' | 'toml' | 'text' | 'xml' | 'groovy';
  extractDeps: string;
  confidence: number;
}

export interface LanguagePattern {
  language: DiscoveredLanguage | string;
  indicators: string[];
  extensions: string[];
  source_patterns: ImportPattern[];
  dep_files: DependencyFilePattern[];
  exclude_dirs: string[];
}

export interface ManifestDiscoverConfig {
  languages: string[];
  min_confidence: number;
  exclude_dirs: string[];
  additional_patterns: LanguagePattern[];
}

export interface DiscoveredEdge {
  from_id: string;
  to_id: string;
  type: EdgeType;
  source: 'inferred';
  confidence: number;
  evidence: {
    language: string;
    strategy: DiscoverSource;
    matched_file: string;
    matched_pattern: string;
  };
}

export interface AmbiguousRelation {
  kind: 'low_confidence' | 'unmatched_target' | 'external_unmatched' | 'multiple_targets' | 'circular';
  /**
   * 'actionable' = agent should fix (e.g. create a card for an internal file).
   * 'informational' = no action needed (e.g. external package or language builtin).
   */
  severity?: 'actionable' | 'informational';
  from_file: string;
  from_card_id?: string;
  reference: string;
  suggested_targets?: string[];
  language: string;
  confidence?: number;
}

export interface DiscoverResult {
  project_languages: string[];
  discovered_edges: DiscoveredEdge[];
  ambiguous: AmbiguousRelation[];
  summary: {
    total_discovered: number;
    high_confidence: number;
    low_confidence: number;
    unmatched_refs: number;
    external_refs: number;
    actionable: number;
  };
}
