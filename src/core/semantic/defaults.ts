import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
} from './transformers';

/** Stable metadata identity for the v1.3.1 semantic runtime. */
export const SEMANTIC_METADATA_VERSION = 1;
export const SEMANTIC_CHUNK_STRATEGY = 'heading-aware-v1';
export const DEFAULT_SEMANTIC_SOURCE = 'modelscope' as const;

export interface DefaultSemanticModelSpec {
  model: string;
  revision: string;
  dtype: typeof DEFAULT_SEMANTIC_DTYPE;
  dimension: number;
  source: 'modelscope' | 'huggingface';
  cachePath: string;
}

export function defaultSemanticCachePath(): string {
  return path.join(
    os.homedir(),
    '.pmem-global',
    'models',
    ...DEFAULT_SEMANTIC_MODEL.split('/'),
    DEFAULT_SEMANTIC_MODEL_REVISION,
  );
}

export function defaultSemanticModelSpec(
  cachePath = defaultSemanticCachePath(),
  source: DefaultSemanticModelSpec['source'] = DEFAULT_SEMANTIC_SOURCE,
): DefaultSemanticModelSpec {
  return {
    model: DEFAULT_SEMANTIC_MODEL,
    revision: DEFAULT_SEMANTIC_MODEL_REVISION,
    dtype: DEFAULT_SEMANTIC_DTYPE,
    dimension: DEFAULT_SEMANTIC_DIMENSION,
    source,
    cachePath,
  };
}
