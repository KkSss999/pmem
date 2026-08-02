import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { SemanticModelSpec, SemanticOperations, SemanticRuntimeStatus } from './semantic';
import {
  createOfflineTransformersProvider,
  assertSemanticRuntimeAvailable,
  loadSemanticCompanion,
  nativeDynamicImport,
  type SemanticCompanionLoader,
} from '../core/semantic/transformers';
import { inspectSemanticReadiness } from '../core/health/semantic';
import { PACKAGE_VERSION } from '../version';
import { loadManifest } from '../core/manifest';
import {
  inspectModelCache,
  MODELSCOPE_SOURCE_REVISION,
  MODEL_UINT8_SHA256,
  REQUIRED_MODEL_FILES,
  semanticReceiptPath,
  sha256File,
  type SemanticModelReceipt as ModelReceipt,
} from '../core/semantic/cache';
export { inspectModelCache, MODELSCOPE_SOURCE_REVISION, MODEL_UINT8_SHA256, REQUIRED_MODEL_FILES } from '../core/semantic/cache';

export { nativeDynamicImport } from '../core/semantic/transformers';

function receiptPath(spec: SemanticModelSpec): string {
  return semanticReceiptPath(spec);
}

function expectedSourceRevision(spec: SemanticModelSpec): string {
  return spec.source === 'modelscope' ? MODELSCOPE_SOURCE_REVISION : spec.revision;
}

function sourceUrl(spec: SemanticModelSpec, file: string): URL {
  const encodedFile = file.split('/').map(encodeURIComponent).join('/');
  if (spec.source === 'modelscope') {
    return new URL(`https://www.modelscope.cn/models/${spec.model}/resolve/${MODELSCOPE_SOURCE_REVISION}/${encodedFile}`);
  }
  return new URL(`https://huggingface.co/${spec.model}/resolve/${spec.revision}/${encodedFile}`);
}

function getWithRedirects(url: URL, redirects = 0): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'user-agent': `pmem-semantic-setup/${PACKAGE_VERSION}`, accept: 'application/octet-stream' },
    }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 8) return reject(new Error(`Too many redirects downloading ${url}`));
        const next = new URL(response.headers.location, url);
        if (next.protocol !== 'https:') return reject(new Error(`Refusing non-HTTPS redirect to ${next}`));
        void getWithRedirects(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed (${status}) for ${url}`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(30_000, () => request.destroy(new Error(`Download timed out for ${url}`)));
    request.on('error', reject);
  });
}

async function downloadAtomic(url: URL, destination: string): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const response = await getWithRedirects(url);
    await pipeline(response, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function downloadModelSnapshot(spec: SemanticModelSpec): Promise<ModelReceipt> {
  fs.mkdirSync(spec.cachePath, { recursive: true });
  for (const file of REQUIRED_MODEL_FILES) {
    await retryTransientDownload(() => downloadAtomic(sourceUrl(spec, file), path.join(spec.cachePath, file)));
  }
  const files: ModelReceipt['files'] = [];
  for (const file of REQUIRED_MODEL_FILES) {
    const localPath = path.join(spec.cachePath, file);
    files.push({ path: file, size: fs.statSync(localPath).size, sha256: await sha256File(localPath) });
  }
  const onnx = files.find(file => file.path === 'onnx/model_uint8.onnx');
  if (onnx?.sha256 !== MODEL_UINT8_SHA256) {
    throw new Error(`Semantic model integrity check failed for onnx/model_uint8.onnx (expected ${MODEL_UINT8_SHA256}, got ${onnx?.sha256 ?? 'missing'}).`);
  }
  return {
    model: spec.model,
    revision: spec.revision,
    source: spec.source,
    source_revision: expectedSourceRevision(spec),
    dtype: spec.dtype,
    dimension: spec.dimension,
    files,
    cached_at: new Date().toISOString(),
  };
}

async function loadCore(): Promise<any> {
  // Core is CommonJS in this package. Keeping this indirection makes the CLI
  // boundary independently testable while the semantic index implementation evolves.
  return require('../core/semantic');
}

async function retryTransientDownload<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const code = error?.cause?.code ?? error?.code;
      const transient = code === 'ECONNRESET'
        || code === 'ETIMEDOUT'
        || code === 'EAI_AGAIN'
        || /fetch failed|timed out|Download failed \(5\d\d\)/i.test(error?.message ?? '');
      if (!transient || attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

export function createDefaultSemanticOperations(
  loadCompanion: SemanticCompanionLoader = nativeDynamicImport,
): SemanticOperations {
  return {
    async prepareModel(spec): Promise<void> {
      // Fail before downloading ~145 MB when the explicitly opt-in inference
      // runtime is unavailable or incompatible.
      await loadSemanticCompanion(loadCompanion);
      await assertSemanticRuntimeAvailable(loadCompanion);
      const existing = await inspectModelCache(spec);
      if (existing.cached) return;
      const receipt = await downloadModelSnapshot(spec);
      const temporaryReceipt = `${receiptPath(spec)}.tmp-${process.pid}`;
      fs.writeFileSync(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryReceipt, receiptPath(spec));
      const verified = await inspectModelCache(spec);
      if (!verified.cached) throw new Error('Semantic model cache verification failed after download.');
    },

    async status(pmemPath, spec): Promise<SemanticRuntimeStatus> {
      const receipt = await inspectModelCache(spec);
      try {
        const core = await loadCore();
        const value = await core.getSemanticProjectStatus(pmemPath);
        const manifest = loadManifest(pmemPath);
        const readiness = manifest ? inspectSemanticReadiness(pmemPath, manifest) : null;
        return {
          modelCached: receipt.cached,
          cacheIntegrity: receipt.integrity,
          available: value.available === true,
          indexedCards: value.cardCount ?? 0,
          indexedChunks: value.chunkCount ?? 0,
          indexRevision: value.revision ?? null,
          pipelineVersion: value.pipelineVersion ?? null,
          indexCompatible: value.available === true
            && value.pipelineVersion != null
            && value.compatible === true,
          indexFresh: readiness?.index_fresh ?? false,
          buildStatus: value.buildStatus,
          failedCardCount: value.failedCardCount,
          failedCardIds: value.failedCardIds,
          eligibleCards: readiness?.eligible_cards ?? 0,
          excludedCards: readiness?.excluded_cards ?? 0,
          excludedByReason: readiness?.excluded_by_reason ?? {},
          excludedByTrustDetail: readiness?.excluded_by_trust_detail ?? {},
        };
      } catch {
        return {
          modelCached: receipt.cached,
          cacheIntegrity: receipt.integrity,
          available: false,
          indexedCards: 0,
          indexedChunks: 0,
          indexRevision: null,
          pipelineVersion: null,
          indexCompatible: false,
          indexFresh: false,
          buildStatus: 'none',
          failedCardCount: 0,
          failedCardIds: [],
          eligibleCards: 0,
          excludedCards: 0,
          excludedByReason: {},
          excludedByTrustDetail: {},
        };
      }
    },

    async rebuild(pmemPath, spec, mode) {
      const receipt = await inspectModelCache(spec);
      if (!receipt.cached) {
        throw new Error(`Semantic model cache is ${receipt.integrity}. Re-run \`pmem semantic setup\` while online.`);
      }
      const core = await loadCore();
      const provider = await createOfflineTransformersProvider(spec, loadCompanion);
      try {
        const result = await core.rebuildSemanticProject(pmemPath, provider, { mode });
        return {
          indexedCards: result.cardsIndexed ?? result.cardsSeen - result.cardsExcluded,
          indexedChunks: result.chunksTotal,
          eligibleCards: result.cardsSeen - result.cardsExcluded,
          excludedCards: result.cardsExcluded,
          buildStatus: result.buildStatus,
          cardsFailed: result.cardsFailed,
          failedCardIds: result.failedCardIds,
          failures: result.failures,
        };
      } finally {
        await provider.dispose();
      }
    },

    async clear(pmemPath) {
      const core = await loadCore();
      const removedChunks = await core.clearSemanticProject(pmemPath);
      return { removedChunks };
    },
  };
}
