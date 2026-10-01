import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EmbeddingProvider } from './types';

export const DEFAULT_SEMANTIC_MODEL = 'Xenova/multilingual-e5-small';
export const DEFAULT_SEMANTIC_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const DEFAULT_SEMANTIC_DTYPE = 'uint8' as const;
export const DEFAULT_SEMANTIC_DIMENSION = 384;

export interface TransformersModelSpec {
  model: string;
  revision: string;
  dtype: 'uint8';
  dimension: number;
  source?: 'modelscope' | 'huggingface';
  cachePath: string;
}

export interface DisposableEmbeddingProvider extends EmbeddingProvider {
  dispose(): Promise<void>;
}

export type TransformersRuntimeLoader = (specifier: string) => Promise<unknown>;

const TRANSFORMERS_PACKAGE = '@huggingface/transformers';
const packageRequire = createRequire(__filename);

/** Preserve native import() in the CommonJS build for ESM-only Transformers.js. */
export async function nativeDynamicImport(specifier: string): Promise<any> {
  const importer = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<any>;
  return importer(specifier);
}

function transformersRuntimeError(cause: unknown): Error {
  const error = new Error(
    'The local Transformers runtime is unavailable. '
    + 'Reinstall pmem with npm install -g pmem-ai@latest, then retry.',
    { cause },
  ) as Error & { code?: string };
  error.code = 'PMEM_TRANSFORMERS_MISSING';
  return error;
}

async function loadTransformers(
  load: TransformersRuntimeLoader = nativeDynamicImport,
): Promise<any> {
  let specifier = TRANSFORMERS_PACKAGE;
  try {
    if (load === nativeDynamicImport) {
      specifier = pathToFileURL(packageRequire.resolve(TRANSFORMERS_PACKAGE)).href;
    }
    const loaded = await load(specifier) as any;
    return loaded?.default ?? loaded;
  } catch (error) {
    throw transformersRuntimeError(error);
  }
}

async function withTransformersEnvironment<T>(
  transformers: any,
  spec: TransformersModelSpec,
  allowRemoteModels: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = {
    allowRemoteModels: transformers.env.allowRemoteModels,
    allowLocalModels: transformers.env.allowLocalModels,
    cacheDir: transformers.env.cacheDir,
  };
  transformers.env.allowRemoteModels = allowRemoteModels;
  transformers.env.allowLocalModels = true;
  transformers.env.cacheDir = spec.cachePath;
  try {
    return await operation();
  } finally {
    transformers.env.allowRemoteModels = previous.allowRemoteModels;
    transformers.env.allowLocalModels = previous.allowLocalModels;
    transformers.env.cacheDir = previous.cacheDir;
  }
}

/** Import the bundled Transformers.js runtime without loading a model. */
export async function assertTransformersRuntimeAvailable(
  load: TransformersRuntimeLoader = nativeDynamicImport,
): Promise<void> {
  await loadTransformers(load);
}

/** Create an offline-only provider for the pinned local E5 model. */
export async function createOfflineTransformersProvider(
  spec: TransformersModelSpec,
  load: TransformersRuntimeLoader = nativeDynamicImport,
): Promise<DisposableEmbeddingProvider> {
  if (!spec.cachePath || !path.isAbsolute(spec.cachePath)) {
    throw new Error(`Semantic model path must be absolute: ${spec.cachePath}`);
  }
  const transformers = await loadTransformers(load);
  const extractor: any = await withTransformersEnvironment(transformers, spec, false, () =>
    transformers.pipeline('feature-extraction', spec.cachePath, {
      dtype: spec.dtype,
      local_files_only: true,
    }),
  );
  return {
    modelId: spec.model,
    revision: spec.revision,
    dimension: spec.dimension,
    async embedPassages(texts) {
      const result: any = await withTransformersEnvironment(transformers, spec, false, () =>
        extractor(texts.map(text => `passage: ${text}`), { pooling: 'mean', normalize: true }),
      );
      return result.tolist();
    },
    async embedQuery(text) {
      const result: any = await withTransformersEnvironment(transformers, spec, false, () =>
        extractor(`query: ${text}`, { pooling: 'mean', normalize: true }),
      );
      const values = result.tolist();
      return Array.isArray(values[0]) ? values[0] : values;
    },
    async dispose() {
      await extractor.dispose?.();
    },
  };
}
