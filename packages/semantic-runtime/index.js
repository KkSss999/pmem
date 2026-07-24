'use strict';

function nativeDynamicImport(specifier) {
  const importer = new Function('specifier', 'return import(specifier)');
  return importer(specifier);
}

async function withTransformersEnvironment(transformers, spec, allowRemoteModels, fn) {
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

async function createOfflineTransformersProvider(spec, importTransformers = nativeDynamicImport) {
  if (!spec.cachePath || !spec.cachePath.startsWith('/')) {
    throw new Error(`Semantic model path must be absolute: ${spec.cachePath}`);
  }
  const transformers = await importTransformers('@huggingface/transformers');
  const extractor = await withTransformersEnvironment(transformers, spec, false, () =>
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
      const result = await withTransformersEnvironment(transformers, spec, false, () =>
        extractor(texts.map(text => `passage: ${text}`), { pooling: 'mean', normalize: true }),
      );
      return result.tolist();
    },
    async embedQuery(text) {
      const result = await withTransformersEnvironment(transformers, spec, false, () =>
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

module.exports = {
  apiVersion: 1,
  createOfflineTransformersProvider,
};
