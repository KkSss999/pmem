import * as yaml from 'js-yaml';
import { Manifest, ManifestV03 } from '../types';
import * as fs from './fs';

export function getDefaultManifest(projectName: string, initMode: string = 'minimal'): Manifest {
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
      initialized_mode: initMode as any,
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
    indexes: {
      path: '.pmem/indexes',
      generated: true,
      graph: {
        mode: 'single',
        path: '.pmem/indexes/graph.json',
      },
      keyword: {
        mode: 'bm25',
        path: '.pmem/indexes/bm25.json',
      },
      hashes: {
        path: '.pmem/indexes/card_hashes.json',
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
      max_tokens: { module: 1200, feature: 1000, decision: 800, task: 600, trace: 1000 },
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

export function getDefaultManifestV03(projectName: string, initMode: string = 'minimal'): ManifestV03 {
  const base = getDefaultManifest(projectName, initMode);
  return {
    ...base,
    pmem: {
      schema_version: '0.3',
      protocol_version: '0.3',
      created_by: '0.3.0',
      last_migrated_by: null,
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
    cli: {
      default_format: 'compact',
      supported_formats: ['compact', 'json', 'paths', 'pack'],
      default_budget: 1600,
    },
    embedding: {
      enabled: false,
      provider: 'none',
      model: null,
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
  } as ManifestV03;
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
