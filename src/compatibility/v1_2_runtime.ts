/**
 * v1.2 runtime compatibility boundary.
 *
 * All legacy Card/Manifest/SQLite query and capture adapters are imported from
 * this module so the v1.3 Runtime implementation only sees canonical ports.
 */
import { askQuery, askQueryWithSemantic } from '../core/query/ask';
import { recallQuery } from '../core/query/recall';
import { contextQuery } from '../core/query/context';
import { relatedQuery } from '../core/query/related';
import { statusQuery } from '../core/query/status';
import { captureCore } from '../core/capture';
import { loadManifest, saveManifest } from '../core/manifest';
import { getCurrentBranch } from '../core/git';
import { createOfflineTransformersProvider, inspectModelCache } from '../core/semantic';
import { defaultSemanticModelSpec } from '../core/semantic/defaults';
export {
  askQuery,
  askQueryWithSemantic,
} from '../core/query/ask';
export type {
  AskOptions,
  AskResultV03,
} from '../core/query/ask';
export type { RecallQueryResult } from '../core/query/recall';
export type { RelatedResult } from '../core/query/related';
export type { StatusResult } from '../core/query/status';
export type { CaptureOptions, CaptureResult } from '../core/capture';
export type { ContextQueryResult, MemoryCard } from '../types';
export { recallQuery } from '../core/query/recall';
export { contextQuery } from '../core/query/context';
export { relatedQuery } from '../core/query/related';
export { statusQuery } from '../core/query/status';
export { captureCore } from '../core/capture';
export { loadManifest } from '../core/manifest';
export { getCurrentBranch } from '../core/git';
export { forgetMemory } from '../core/db';
export {
  createOfflineTransformersProvider,
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
  getSemanticStatus,
  inspectModelCache,
} from '../core/semantic';
export type { DisposableEmbeddingProvider } from '../core/semantic';

/**
 * Explicit v1.2 composition adapter. Commands and migration/import callers
 * opt into this facade; the canonical Runtime never imports legacy core code
 * or creates a hidden SQLite connection.
 */
import { Pmem } from '../runtime';
import { loadRuntimeConfig } from '../runtime/config';
import { EventStore } from '../runtime/event-store';
import type { PmemOpenOptions, RuntimeLegacyAdapter } from '../runtime/types';
import { EMPTY_SCHEMA_REGISTRY, SqliteMemoryBackend } from '../storage/sqlite';

export async function openV12Pmem(
  options: Omit<PmemOpenOptions, 'backend' | 'legacy'> & { backend?: import('../runtime/model').MemoryBackend },
): Promise<Pmem> {
  const pmemPath = require('node:path').join(options.root, '.pmem');
  ensureDefaultSemanticManifest(pmemPath);
  const backend = options.backend ?? new SqliteMemoryBackend(pmemPath);
  if (!(backend instanceof SqliteMemoryBackend)) {
    throw new Error('legacyV12 compatibility requires an explicit legacy adapter for a non-SQLite backend. Pmem.open will not create a hidden SQLite backend.');
  }
  await backend.open({ root: options.root, schema: options.schema ?? EMPTY_SCHEMA_REGISTRY });
  const database = backend.database;
  if (!database) throw new Error('v1.2 SQLite adapter failed to open.');
  const config = loadV12RuntimeConfig(options.root, options.preset, options.config);
  return Pmem.open({
    ...options,
    backend,
    config,
    legacy: createV12RuntimeAdapter(options.root, pmemPath, database, config.working.ttl),
  });
}

export function createV12RuntimeAdapter(
  root: string,
  pmemPath: string,
  db: import('../storage/sqlite').SqliteDatabase,
  workingTtl = '12h',
): RuntimeLegacyAdapter {
  const events = new EventStore(db, workingTtl);
  return {
    async ask(query, opts) {
      const deterministic = askQuery(pmemPath, query, { ...opts, now: opts?.now ?? Date.now(), db });
      const manifest = loadManifest(pmemPath) as any;
      const embedding = manifest?.embedding;
      if (!embedding?.enabled) return deterministic;
      const cache = await inspectModelCache({
        model: embedding.model, revision: embedding.revision, dtype: embedding.dtype,
        dimension: embedding.dimension, source: embedding.source, cachePath: embedding.cache_path,
      });
      if (!cache.cached) {
        return { ...deterministic, warnings: [`Semantic retrieval degraded to deterministic recall: Semantic model cache is ${cache.integrity}. Re-run \`pmem semantic setup\` while online.`] };
      }
      try {
        const provider = await createOfflineTransformersProvider({
          model: embedding.model, revision: embedding.revision, dtype: embedding.dtype,
          dimension: embedding.dimension, source: embedding.source, cachePath: embedding.cache_path,
        });
        try {
          return await askQueryWithSemantic(pmemPath, query, provider, { ...opts, now: opts?.now ?? Date.now(), db });
        } finally {
          await provider.dispose();
        }
      } catch (error: any) {
        return { ...deterministic, warnings: [`Semantic retrieval degraded to deterministic recall: ${error?.message ?? String(error)}`] };
      }
    },
    async recall(opts) { return recallQuery(pmemPath, { ...opts, db, cwd: root }); },
    async context(task, budget) {
      const result = contextQuery(pmemPath, task, budget, db, root);
      const ask = await this.ask(task, { limit: 12, explain: true });
      if (ask.warnings) result.warnings.push(...ask.warnings);
      return result;
    },
    async related(id, opts) { return relatedQuery(pmemPath, id, { ...opts, db }); },
    async status(opts) { return statusQuery(pmemPath, { ...opts, db, cwd: root }); },
    async capture(summary, options) {
      return { ...captureCore(pmemPath, { ...options, summary: summary || options.summary, cwd: root, deferRuntimeEvent: true }), branch: getCurrentBranch(root) ?? undefined };
    },
    findEvent(id) { return events.find(id); },
    expireEvents() { events.expire(); },
    mergeBranchMemory(sourceBranch, targetBranch) { return events.mergeBranch(sourceBranch, targetBranch); },
    async refreshSemanticIndex(mode) {
      const manifest = loadManifest(pmemPath) as any;
      const embedding = manifest?.embedding;
      if (!embedding?.enabled || embedding.auto_enabled === false) {
        return { status: 'unavailable' as const, reason: 'semantic disabled' };
      }
      const spec = defaultSemanticModelSpec(
        embedding.cache_path ?? undefined,
        embedding.source ?? 'modelscope',
      );
      const cache = await inspectModelCache(spec);
      if (!cache.cached) return { status: 'unavailable' as const, reason: `model cache ${cache.integrity}` };
      try {
        const provider = await createOfflineTransformersProvider(spec);
        try {
          const core = await import('../core/semantic');
          const result = await core.rebuildSemanticProject(pmemPath, provider, { mode });
          return { status: result.buildStatus === 'complete' ? 'ready' as const : 'degraded' as const, indexedCards: result.cardsIndexed, indexedChunks: result.chunksTotal, ...(result.buildStatus === 'partial' ? { reason: 'semantic index is partial' } : {}) };
        } finally {
          await provider.dispose();
        }
      } catch (error: any) {
        return { status: 'degraded' as const, reason: error?.message ?? String(error) };
      }
    },
  };
}

/**
 * v1.3.1 makes semantic a default Runtime capability without downloading or
 * importing a model on open. An explicit `auto_enabled: false` survives clear
 * and is the only opt-out marker.
 */
function ensureDefaultSemanticManifest(pmemPath: string): void {
  const manifest = loadManifest(pmemPath) as any;
  if (!manifest?.embedding || manifest.embedding.auto_enabled === false || manifest.embedding.enabled) return;
  const spec = defaultSemanticModelSpec();
  manifest.embedding = {
    enabled: true,
    auto_enabled: true,
    provider: 'local',
    model: spec.model,
    revision: spec.revision,
    source: spec.source,
    dtype: spec.dtype,
    cache_path: spec.cachePath,
    dimension: spec.dimension,
    store: 'sqlite',
    index: 'flat',
  };
  saveManifest(pmemPath, manifest);
}

export function loadV12RuntimeConfig(
  root: string,
  preset?: string,
  overrides?: import('../runtime/types').PartialRuntimeConfig,
): import('../runtime/types').RuntimeConfig {
  const manifest = loadManifest(require('node:path').join(root, '.pmem')) as any;
  const manifestPreset = typeof manifest?.project?.domain === 'string' ? manifest.project.domain : undefined;
  const selected = preset ?? manifestPreset ?? 'software';
  const memory = manifest?.memory ?? {};
  return loadRuntimeConfig(selected, {
    defaultScope: memory.default_scope ?? 'project',
    branchAware: memory.branch_aware ?? true,
    working: { ttl: memory.working?.ttl ?? '12h' },
    episodic: { capture: memory.episodic?.capture ?? 'automatic' },
    durable: {
      format: memory.durable?.format ?? 'markdown',
      confirmation: memory.durable?.confirmation ?? 'required',
    },
    ...overrides,
  });
}
