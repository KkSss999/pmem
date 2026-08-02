import * as yaml from 'js-yaml';
import { Manifest, ManifestV03, InitMode, ResolvedConfig } from '../types';
import * as fs from './fs';
import { DOMAIN_PRESETS } from './domainPresets';

// v0.7.0: v0.6.4 id_pattern whitelist — the exact types accepted at runtime.
// Sourced from src/core/manifest.ts:113 (card_policy.id_pattern regex).
export const V064_DEFAULT_TYPES = [
  'project', 'module', 'feature', 'task', 'decision',
  'trace', 'risk', 'assumption', 'resource', 'integration',
];

// v0.7.0: v0.6.4 distill merge target types (hardcoded in distill.ts).
export const V064_DEFAULT_MERGE_TYPES = ['module', 'decision', 'task', 'feature'];

// v0.7.0: v0.6.4 VALID_TYPES from new.ts — the exact 6 types `pmem new`
// accepted before v0.7.0. Narrower than id_pattern (10 types) because
// project/assumption/resource/integration exist for compat but are not
// creatable (their directories may be excluded from rebuild).
export const V064_DEFAULT_CREATABLE_TYPES = ['decision', 'module', 'task', 'feature', 'risk', 'trace'];

/**
 * Compute a ResolvedConfig from a manifest object.
 *
 * v0.7.0 contract:
 * - If manifest.schema.card_types is defined → use it.
 * - Otherwise → fall back to the v0.6.4 id_pattern whitelist.
 * - This is a PURE FUNCTION — it does NOT write back to the manifest file.
 *   The only path that writes schema.* fields is `pmem init --domain ...`.
 */
export function resolveConfig(manifest: Manifest): ResolvedConfig {
  const schema = (manifest as ManifestV03).schema;
  const legacyDomain = manifest.project?.domain;
  const preset = legacyDomain ? DOMAIN_PRESETS[legacyDomain] : undefined;

  const card_types = schema?.card_types ?? preset?.card_types ?? [...V064_DEFAULT_TYPES];

  // type_dirs: schema wins; documented legacy project.domain presets remain
  // readable without mutating old manifests; custom types fall back to `${type}s`.
  const type_dirs: Record<string, string> = {};
  for (const t of card_types) {
    if (schema?.type_dirs?.[t]) {
      type_dirs[t] = schema.type_dirs[t];
    } else if (preset?.type_dirs?.[t]) {
      type_dirs[t] = preset.type_dirs[t];
    } else {
      type_dirs[t] = `${t}s`;
    }
  }

  return {
    card_types,
    type_dirs,
    foundational_types: schema?.foundational_types ?? preset?.foundational_types ?? ['module'],
    evidence_types: schema?.evidence_types ?? preset?.evidence_types ?? ['decision', 'trace'],
    default_type: schema?.default_type ?? preset?.default_type ?? 'trace',
    merge_target_types: (manifest as ManifestV03).distill?.merge_target_types ?? [...V064_DEFAULT_MERGE_TYPES],

    // creatable_types: types accepted by `pmem new`.
    // - If schema.creatable_types is defined → use it.
    // - If legacy project.domain names a documented preset → use that preset.
    // - Otherwise (compat fallback):
    //   - If schema.card_types is defined → all card_types minus non-creatable utility types
    //   - Otherwise → v0.6.4 default creatable types
    creatable_types: schema?.creatable_types
      ? schema.creatable_types
      : (preset?.creatable_types
          ? preset.creatable_types
          : (schema?.card_types
              ? card_types.filter(t => t !== 'integration' && t !== 'project' && t !== 'assumption' && t !== 'resource')
              : [...V064_DEFAULT_CREATABLE_TYPES])),
  };
}

/**
 * Render a card_policy.id_pattern by replacing the `{types}` placeholder
 * with the regex-escaped card type names.
 *
 * If the pattern contains `{types}`, it is replaced with the alternation
 * of all card_types (each regex-escaped).  If the pattern does NOT contain
 * `{types}`, it is returned unchanged (v0.6.4 compat).
 */
export function renderIdPattern(idPattern: string, cardTypes: string[]): string {
  if (!idPattern.includes('{types}')) return idPattern;
  const escaped = cardTypes.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return idPattern.replace('{types}', escaped.join('|'));
}

export function getDefaultManifest(projectName: string, initMode: InitMode = 'minimal'): ManifestV03 {
  return {
    pmem: {
      schema_version: '0.3',
      protocol_version: '0.3',
      created_by: '0.3.0',
      last_migrated_by: null,
    },
    project: {
      name: projectName,
      language: 'zh-CN',
      status: 'active',
    },
    memory_status: {
      completeness: initMode === 'guided' ? 'partial' : 'incomplete',
      initialized_mode: initMode,
      dirty: false,
      dirty_since: null,
      dirty_reason: null,
    },
    source_of_truth: {
      type: 'markdown_cards',
      path: '.pmem',
      card_globs: [
        '.pmem/modules/**/*.md',
        '.pmem/features/**/*.md',
        '.pmem/decisions/**/*.md',
        '.pmem/tasks/**/*.md',
        '.pmem/traces/**/*.md',
        '.pmem/risks/**/*.md',
      ],
    },
    runtime: {
      mode: 'sqlite',
      db_path: '.pmem/pmem.db',
      markdown_source: true,
    },
    indexes: {
      primary: 'sqlite',
      legacy_json: {
        enabled: false,
        retained: true,
        path: '.pmem/indexes',
      },
    },
    rebuild: {
      strategy: 'content_hash',
      hash: {
        file_hash: true,
        frontmatter_hash: true,
        body_hash: true,
      },
    },
    concurrency: {
      mode: 'file-basic',
      atomic_write: true,
      lock: {
        enabled: true,
        path: '.pmem/.lock',
        timeout: '3s',
        stale_after: '60s',
        on_timeout: 'abort',
      },
      optimistic_lock: {
        enabled: false,
        note: 'Deferred to SQLite runtime in v0.3',
      },
    },
    cli: {
      default_format: 'compact',
      supported_formats: ['compact', 'json', 'paths', 'pack'],
      default_budget: 1600,
    },
    embedding: {
      enabled: false,
      auto_enabled: true,
      provider: 'none',
      model: null,
      revision: null,
      source: null,
      dtype: null,
      cache_path: null,
      dimension: null,
      store: 'sqlite',
      index: 'none',
    },
    serve: {
      enabled: false,
      mode: 'none',
      experimental: {
        mcp: false,
        rest: false,
      },
    },
    auto_update: {
      enabled: true,
      on_code_change: 'mark_dirty',
      on_doc_change: 'mark_dirty',
      on_memory_change: 'rebuild_indexes',
      on_session_end: 'prompt',
      on_git_commit: 'suggest_trace',
      min_trace_interval: '30m',
      max_auto_traces_per_day: 5,
      ignore_patterns: [
        'node_modules/**', 'dist/**', 'build/**', '*.lock', '*.log',
      ],
      trace_policy: {
        require_meaningful_change: true,
        require_summary: true,
        require_related_node: true,
      },
    },
    card_policy: {
      id_pattern: '^(project|module|feature|task|decision|trace|risk|assumption|resource|integration)\\.[a-z0-9._-]+$',
      max_tokens: { module: 1200, feature: 1000, decision: 1000, task: 800, trace: 1000 },
      max_sections: { module: 8, feature: 8, decision: 6, task: 6 },
      warn_when_related_count_gt: 12,
    },
    distill: {
      enabled: true,
      cadence: 'weekly',
      max_undistilled_traces: 20,
      require_confirmation: true,
      suggest_card_splits: true,
    },
    freshness: {
      default_ttl: '14d',
      stale_on_related_code_change: true,
      require_last_verified: true,
    },
    integrations: {
      active: [],
    },
    migrations: {
      applied: [],
    },
  };
}

export function getDefaultManifestV03(projectName: string, initMode: InitMode = 'minimal'): ManifestV03 {
  return getDefaultManifest(projectName, initMode);
}

export function loadManifest(pmemDir: string): Manifest | null {
  const filePath = `${pmemDir}/manifest.yml`;
  const content = fs.readFile(filePath);
  if (!content) return null;
  try {
    return yaml.load(content) as Manifest;
  } catch {
    return null;
  }
}

export function saveManifest(pmemDir: string, manifest: Manifest): void {
  const yamlStr = yaml.dump(manifest, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  // Use atomic write for manifest to prevent corruption
  const filePath = `${pmemDir}/manifest.yml`;
  const fsModule = require('./fs');
  if (fsModule.atomicWrite) {
    fsModule.atomicWrite(filePath, yamlStr);
  } else {
    fs.writeFile(filePath, yamlStr);
  }
}
