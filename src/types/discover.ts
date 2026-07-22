import type { EdgeType } from './graph';

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
