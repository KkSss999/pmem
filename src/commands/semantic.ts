import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { ManifestV03 } from '../types';
import { loadManifest, saveManifest } from '../core/manifest';
import { fileExists } from '../core/fs';
import { createDefaultSemanticOperations } from './semanticRuntime';
import {
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
  SEMANTIC_COMPANION_PACKAGE,
  SEMANTIC_COMPANION_VERSION,
} from '../core/semantic/transformers';

export const SEMANTIC_MODEL = DEFAULT_SEMANTIC_MODEL;
export const SEMANTIC_MODEL_REVISION = DEFAULT_SEMANTIC_MODEL_REVISION;
export const SEMANTIC_DTYPE = DEFAULT_SEMANTIC_DTYPE;
export const SEMANTIC_DIMENSION = DEFAULT_SEMANTIC_DIMENSION;
export const SEMANTIC_APPROX_DOWNLOAD = '145 MB';
export const DEFAULT_SEMANTIC_SOURCE = 'modelscope' as const;
export type SemanticModelSource = 'modelscope' | 'huggingface';

export interface SemanticModelSpec {
  model: string;
  revision: string;
  dtype: typeof SEMANTIC_DTYPE;
  dimension: number;
  source: SemanticModelSource;
  cachePath: string;
}

export interface SemanticRuntimeStatus {
  modelCached: boolean;
  cacheIntegrity: 'ok' | 'missing' | 'corrupt' | 'unknown';
  indexedCards: number;
  indexedChunks: number;
  indexRevision: string | null;
  pipelineVersion?: number | null;
  indexCompatible?: boolean;
  indexFresh?: boolean;
  eligibleCards?: number;
  excludedCards?: number;
  excludedByReason?: Record<string, number>;
  excludedByTrustDetail?: Record<string, number>;
}

export interface SemanticRebuildResult {
  indexedCards: number;
  indexedChunks: number;
}

/** Boundary between CLI/config concerns and the derived semantic index runtime. */
export interface SemanticOperations {
  prepareModel(spec: SemanticModelSpec): Promise<void>;
  status(pmemPath: string, spec: SemanticModelSpec): Promise<SemanticRuntimeStatus>;
  rebuild(pmemPath: string, spec: SemanticModelSpec, mode: 'full' | 'incremental'): Promise<SemanticRebuildResult>;
  clear(pmemPath: string): Promise<{ removedChunks: number }>;
}

export type SemanticAction = 'enable' | 'setup' | 'status' | 'rebuild' | 'clear';

export interface SemanticCommandOptions {
  yes?: boolean;
  format?: 'compact' | 'json';
  full?: boolean;
  cwd?: string;
  source?: SemanticModelSource;
}

interface SemanticCommandDependencies {
  platform: NodeJS.Platform;
  operations: SemanticOperations;
  confirm(question: string): Promise<boolean>;
  log(message: string): void;
}

export function defaultCachePath(): string {
  return path.join(os.homedir(), '.pmem-global', 'models', ...SEMANTIC_MODEL.split('/'), SEMANTIC_MODEL_REVISION);
}

function modelSpec(cachePath = defaultCachePath(), source: SemanticModelSource = DEFAULT_SEMANTIC_SOURCE): SemanticModelSpec {
  return {
    model: SEMANTIC_MODEL,
    revision: SEMANTIC_MODEL_REVISION,
    dtype: SEMANTIC_DTYPE,
    dimension: SEMANTIC_DIMENSION,
    source,
    cachePath,
  };
}

async function confirmInTerminal(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function requireManifest(pmemPath: string): ManifestV03 {
  if (!fileExists(pmemPath)) {
    throw new Error('No .pmem directory found. Run `pmem init` first.');
  }
  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    throw new Error('.pmem/manifest.yml is missing or invalid.');
  }
  if (manifest.pmem.schema_version !== '0.3' || !('embedding' in manifest)) {
    throw new Error('Semantic retrieval requires a v0.3 manifest. Run `pmem migrate --to 0.3` first.');
  }
  return manifest;
}

function configuredSpec(manifest: ManifestV03): SemanticModelSpec {
  const config = manifest.embedding;
  if (!config.enabled) {
    throw new Error('Semantic retrieval is disabled. Run `pmem semantic setup` first.');
  }
  if (
    config.provider !== 'local'
    || config.model !== SEMANTIC_MODEL
    || config.revision !== SEMANTIC_MODEL_REVISION
    || config.dtype !== SEMANTIC_DTYPE
    || config.dimension !== SEMANTIC_DIMENSION
    || config.index !== 'flat'
    || !config.cache_path
    || !path.isAbsolute(config.cache_path)
  ) {
    throw new Error('Semantic manifest configuration is incompatible with v1.2.1. Run `pmem semantic setup` to repair it.');
  }
  return modelSpec(config.cache_path, config.source ?? DEFAULT_SEMANTIC_SOURCE);
}

function writeOutput(log: (message: string) => void, format: 'compact' | 'json', value: object, lines: string[]): void {
  if (format === 'json') {
    log(JSON.stringify(value, null, 2));
  } else {
    for (const line of lines) log(line);
  }
}

function enableManifest(manifest: ManifestV03, spec: SemanticModelSpec): void {
  manifest.embedding = {
    enabled: true,
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
}

export async function semanticCommand(
  action: SemanticAction,
  options: SemanticCommandOptions = {},
  overrides: Partial<SemanticCommandDependencies> = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const pmemPath = path.join(cwd, '.pmem');
  const manifest = requireManifest(pmemPath);
  const deps: SemanticCommandDependencies = {
    platform: overrides.platform ?? process.platform,
    operations: overrides.operations ?? createDefaultSemanticOperations(),
    confirm: overrides.confirm ?? confirmInTerminal,
    log: overrides.log ?? console.log,
  };
  const format = options.format ?? 'compact';

  if (action === 'setup' || action === 'enable') {
    if (deps.platform !== 'darwin') {
      throw new Error(`Semantic ${action} is supported on macOS only in v1.2.1.`);
    }
    const source = options.source ?? DEFAULT_SEMANTIC_SOURCE;
    if (source !== 'modelscope' && source !== 'huggingface') {
      throw new Error('Semantic model source must be `modelscope` or `huggingface`.');
    }
    const spec = modelSpec(defaultCachePath(), source);
    const downloadInfo = {
      action,
      model: spec.model,
      revision: spec.revision,
      dtype: spec.dtype,
      source: spec.source,
      cache_path: spec.cachePath,
      approximate_download: SEMANTIC_APPROX_DOWNLOAD,
    };
    // Keep --format json machine-readable for the one-shot command: its final
    // status is emitted as one JSON document after success/cancellation/failure.
    if (format === 'compact') {
      writeOutput(deps.log, format, downloadInfo, [
        action === 'enable' ? 'Enable semantic retrieval' : 'Semantic model setup',
        `Model: ${spec.model}`,
        `Revision: ${spec.revision}`,
        `Source: ${spec.source}`,
        `ONNX dtype: ${spec.dtype} (model_${spec.dtype}.onnx)`,
        `Cache: ${spec.cachePath}`,
        `Approximate download: ${SEMANTIC_APPROX_DOWNLOAD}`,
      ]);
    }
    if (!options.yes && !(await deps.confirm('Prepare or reuse this model cache and enable semantic retrieval? [y/N] '))) {
      writeOutput(deps.log, format, { ...downloadInfo, status: 'cancelled', manifest_changed: false }, [
        `Semantic ${action} cancelled; no files or configuration were changed.`,
      ]);
      return;
    }

    if (format === 'compact') {
      deps.log('Preparing model cache (this may take several minutes on the first run)...');
    }
    try {
      await deps.operations.prepareModel(spec);
    } catch (error: any) {
      if (format === 'json') {
        const message = error?.message ?? String(error);
        const companionMissing = /companion|ERR_MODULE_NOT_FOUND|not installed/i.test(message);
        deps.log(JSON.stringify({
          ...downloadInfo,
          status: 'setup_failed',
          manifest_changed: false,
          index_ready: false,
          error: message,
          ...(companionMissing
            ? { install_command: `npm install -g ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}` }
            : {}),
          recovery_guidance: companionMissing
            ? `Install the compatible semantic companion, then rerun pmem semantic ${action} --yes --format json.`
            : `Resolve the setup error, then rerun pmem semantic ${action} --yes --format json.`,
        }, null, 2));
      }
      // Compact mode deliberately preserves the companion/downloader's original
      // actionable error. The manifest has not been touched at this point.
      throw error;
    }
    enableManifest(manifest, spec);
    saveManifest(pmemPath, manifest);

    if (action === 'setup') {
      writeOutput(deps.log, format, {
        ...downloadInfo,
        status: 'model_ready',
        manifest_enabled: true,
        index_ready: false,
        next_command: 'pmem semantic rebuild',
      }, [
        'Semantic model is cached and enabled.',
        'Next: run `pmem semantic rebuild` to build the derived index.',
      ]);
      return;
    }

    if (format === 'compact') deps.log('Building the current project semantic index...');
    try {
      const result = await deps.operations.rebuild(pmemPath, spec, 'full');
      writeOutput(deps.log, format, {
        ...downloadInfo,
        status: 'ready',
        manifest_enabled: true,
        index_mode: 'full',
        indexed_cards: result.indexedCards,
        indexed_chunks: result.indexedChunks,
      }, [
        `Semantic retrieval enabled: ${result.indexedCards} cards / ${result.indexedChunks} chunks indexed.`,
        'The model is cached locally and subsequent inference keeps remote loading disabled.',
      ]);
    } catch (error: any) {
      const recovery = 'pmem semantic rebuild --full';
      writeOutput(deps.log, format, {
        ...downloadInfo,
        status: 'index_failed',
        manifest_enabled: true,
        model_cached: true,
        index_ready: false,
        error: error?.message ?? String(error),
        recovery_command: recovery,
      }, [
        'Semantic model setup succeeded and the manifest remains enabled, but index construction failed.',
        `Recover with: ${recovery}`,
      ]);
      throw new Error(
        `Semantic model is cached and enabled, but index construction failed: ${error?.message ?? error}. Recover with: ${recovery}`,
        { cause: error },
      );
    }
    return;
  }

  if (action === 'status') {
    const cachePath = manifest.embedding.cache_path ?? defaultCachePath();
    const spec = modelSpec(cachePath, manifest.embedding.source ?? DEFAULT_SEMANTIC_SOURCE);
    const status = await deps.operations.status(pmemPath, spec);
    const result = {
      enabled: manifest.embedding.enabled,
      provider: manifest.embedding.provider,
      model: manifest.embedding.model,
      revision: manifest.embedding.revision ?? null,
      source: manifest.embedding.source ?? DEFAULT_SEMANTIC_SOURCE,
      dtype: manifest.embedding.dtype ?? null,
      cache_path: cachePath,
      ...status,
    };
    writeOutput(deps.log, format, result, [
      `Semantic: ${manifest.embedding.enabled ? 'enabled' : 'disabled'}`,
      `Model: ${manifest.embedding.model ?? SEMANTIC_MODEL}`,
      `Revision: ${manifest.embedding.revision ?? SEMANTIC_MODEL_REVISION}`,
      `Cache: ${cachePath} (${status.cacheIntegrity})`,
      `Index: ${status.indexedCards} cards / ${status.indexedChunks} chunks`,
      `Readiness: ${status.eligibleCards ?? 0} eligible / ${status.excludedCards ?? 0} excluded; pipeline ${status.pipelineVersion ?? 'none'} (${status.indexCompatible ? 'compatible' : 'incompatible'}, ${status.indexFresh ? 'fresh' : 'stale'})`,
      `Excluded: ${Object.entries(status.excludedByReason ?? {}).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}`,
      `Trust exclusions: ${Object.entries(status.excludedByTrustDetail ?? {}).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}`,
    ]);
    return;
  }

  if (action === 'rebuild') {
    const spec = configuredSpec(manifest);
    const mode = options.full ? 'full' : 'incremental';
    const result = await deps.operations.rebuild(pmemPath, spec, mode);
    writeOutput(deps.log, format, result, [
      `Semantic index rebuilt (${mode}): ${result.indexedCards} cards / ${result.indexedChunks} chunks.`,
      'Remote model loading remained disabled.',
    ]);
    return;
  }

  const result = await deps.operations.clear(pmemPath);
  manifest.embedding.enabled = false;
  saveManifest(pmemPath, manifest);
  writeOutput(deps.log, format, { ...result, enabled: false, model_cache_removed: false }, [
    `Semantic index cleared: ${result.removedChunks} chunks removed.`,
    'Semantic retrieval is disabled. The model cache was preserved for a future setup.',
  ]);
}
