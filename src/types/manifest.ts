import type {
  CliConfig,
  EmbeddingConfig,
  IndexesConfigV03,
  ManifestChangeDetectionConfig,
  ManifestSchemaConfig,
  RebuildConfig,
  RuntimeConfig,
  ServeConfig,
} from './config';

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

export type ManifestSchemaVersion = '0.2' | '0.3';

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
  /** Per-card-type overrides for relation count warning threshold. Falls back to warn_when_related_count_gt when type is not listed. */
  warn_when_related_count_gt_by_type?: Record<string, number>;
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

export type Manifest = ManifestV02 | ManifestV03;
