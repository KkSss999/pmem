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
  /** v1.3.1 default lifecycle opt-in; `false` is an explicit user disable. */
  auto_enabled?: boolean;
  provider: 'none' | 'api' | 'local';
  model: string | null;
  /** Immutable model source revision. Required when local semantic retrieval is enabled. */
  revision?: string | null;
  /** Registry used only by the explicit setup command to populate the shared model directory. */
  source?: 'modelscope' | 'huggingface' | null;
  /** ONNX quantization selected during the explicit setup step. */
  dtype?: 'uint8' | null;
  /** User-level Transformers.js cache. No download is attempted outside semantic setup. */
  cache_path?: string | null;
  dimension: number | null;
  store: 'sqlite';
  index: 'none' | 'flat';
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
