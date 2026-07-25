import type { EmbeddingProvider } from './types';

export const DEFAULT_SEMANTIC_MODEL = 'Xenova/multilingual-e5-small';
export const DEFAULT_SEMANTIC_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const DEFAULT_SEMANTIC_DTYPE = 'uint8' as const;
export const DEFAULT_SEMANTIC_DIMENSION = 384;
export const SEMANTIC_COMPANION_PACKAGE = 'pmem-ai-semantic';
export const SEMANTIC_COMPANION_VERSION = '1.2.1';

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

export interface SemanticCompanion {
  apiVersion: 1;
  createOfflineTransformersProvider(spec: TransformersModelSpec): Promise<DisposableEmbeddingProvider>;
}

export type SemanticCompanionLoader = (specifier: string) => Promise<unknown>;

/** Preserve native import() in the CommonJS build for ESM-only Transformers.js. */
export async function nativeDynamicImport(specifier: string): Promise<any> {
  const importer = new Function('specifier', 'return import(specifier)') as (value: string) => Promise<any>;
  return importer(specifier);
}

function companionInstallError(cause?: unknown): Error {
  const error = new Error(
    `Semantic runtime companion is not installed. Install it explicitly with `
    + `\`npm install -g ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}\` `
    + `(global pmem CLI) or \`npm install ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}\` `
    + `(project SDK), then retry.`,
  );
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

export async function loadSemanticCompanion(
  load: SemanticCompanionLoader = nativeDynamicImport,
): Promise<SemanticCompanion> {
  let loaded: any;
  try {
    loaded = await load(SEMANTIC_COMPANION_PACKAGE);
  } catch (error) {
    throw companionInstallError(error);
  }
  const companion = loaded?.default ?? loaded;
  if (companion?.apiVersion !== 1 || typeof companion?.createOfflineTransformersProvider !== 'function') {
    throw new Error(
      `Installed ${SEMANTIC_COMPANION_PACKAGE} is incompatible with pmem v1.2.1. `
      + `Install ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}.`,
    );
  }
  return companion as SemanticCompanion;
}

/** Create an offline-only E5 provider through the explicitly installed companion. */
export async function createOfflineTransformersProvider(
  spec: TransformersModelSpec,
  load: SemanticCompanionLoader = nativeDynamicImport,
): Promise<DisposableEmbeddingProvider> {
  const companion = await loadSemanticCompanion(load);
  return companion.createOfflineTransformersProvider(spec);
}
