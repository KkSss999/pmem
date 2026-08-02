'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const TRANSFORMERS_PACKAGE = '@huggingface/transformers';
const companionRequire = createRequire(__filename);
const companionVersion = require('./package.json').version;

function nativeDynamicImport(specifier) {
  const importer = new Function('specifier', 'return import(specifier)');
  return importer(specifier);
}

function transformersRuntimeError(cause) {
  const error = new Error(
    `Semantic Transformers runtime is unavailable for pmem-ai-semantic@${companionVersion}. `
    + `Reinstall the compatible companion with `
    + `\`npm install -g pmem-ai-semantic@${companionVersion}\` `
    + `(global pmem CLI) or `
    + `\`npm install pmem-ai-semantic@${companionVersion}\` (project SDK), then retry.`,
  );
  error.code = 'PMEM_SEMANTIC_TRANSFORMERS_MISSING';
  error.cause = cause;
  return error;
}

function resolveTransformersRuntime() {
  try {
    // Resolve from this package so a globally installed companion can use its
    // own nested dependency instead of depending on npm's hoisting layout.
    return companionRequire.resolve(TRANSFORMERS_PACKAGE);
  } catch (error) {
    throw transformersRuntimeError(error);
  }
}

async function loadTransformers(importTransformers = nativeDynamicImport) {
  const specifier = importTransformers === nativeDynamicImport
    ? pathToFileURL(resolveTransformersRuntime()).href
    : TRANSFORMERS_PACKAGE;
  try {
    return await importTransformers(specifier);
  } catch (error) {
    throw transformersRuntimeError(error);
  }
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
  if (!spec.cachePath || !path.isAbsolute(spec.cachePath)) {
    throw new Error(`Semantic model path must be absolute: ${spec.cachePath}`);
  }
  const loaded = await loadTransformers(importTransformers);
  const transformers = loaded?.default ?? loaded;
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
  assertTransformersRuntimeAvailable: async () => {
    await loadTransformers();
  },
  createOfflineTransformersProvider,
};
