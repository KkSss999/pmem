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

/** Preserve native import() in the CommonJS build for ESM-only Transformers.js. */
export async function nativeDynamicImport(specifier: string): Promise<any> {
  const importer = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<any>;
  return importer(specifier);
}

export async function withTransformersEnvironment<T>(
  transformers: any,
  spec: TransformersModelSpec,
  allowRemoteModels: boolean,
  fn: () => Promise<T>,
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
    return await fn();
  } finally {
    transformers.env.allowRemoteModels = previous.allowRemoteModels;
    transformers.env.allowLocalModels = previous.allowLocalModels;
    transformers.env.cacheDir = previous.cacheDir;
  }
}

/** Create an offline-only E5 provider. This function never permits a download. */
export async function createOfflineTransformersProvider(
  spec: TransformersModelSpec,
  importTransformers: (specifier: string) => Promise<any> = nativeDynamicImport,
): Promise<DisposableEmbeddingProvider> {
  const transformers = await importTransformers('@huggingface/transformers');
  const extractor: any = await withTransformersEnvironment<any>(transformers, spec, false, () =>
    transformers.pipeline('feature-extraction', pathAsModelId(spec.cachePath), {
      dtype: spec.dtype,
      local_files_only: true,
    }),
  );
  return {
    modelId: spec.model,
    revision: spec.revision,
    dimension: spec.dimension,
    async embedPassages(texts): Promise<number[][]> {
      const result: any = await withTransformersEnvironment<any>(transformers, spec, false, () =>
        extractor(texts.map(text => `passage: ${text}`), { pooling: 'mean', normalize: true }),
      );
      return result.tolist();
    },
    async embedQuery(text): Promise<number[]> {
      const result: any = await withTransformersEnvironment<any>(transformers, spec, false, () =>
        extractor(`query: ${text}`, { pooling: 'mean', normalize: true }),
      );
      const values = result.tolist();
      return Array.isArray(values[0]) ? values[0] : values;
    },
    async dispose(): Promise<void> {
      await extractor.dispose?.();
    },
  };
}

function pathAsModelId(modelPath: string): string {
  if (!modelPath.startsWith('/')) {
    throw new Error(`Semantic model path must be absolute: ${modelPath}`);
  }
  return modelPath;
}
