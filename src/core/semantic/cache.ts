import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { SEMANTIC_CHUNK_STRATEGY, SEMANTIC_METADATA_VERSION } from './defaults';

export const SEMANTIC_RECEIPT_FILE = 'pmem-semantic-model.json';
export const MODELSCOPE_SOURCE_REVISION = '252d0dcb679dda2c7b6fd5bbfed15df3c7feaebf';
export const MODEL_UINT8_SHA256 = 'ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1';
export const REQUIRED_MODEL_FILES = [
  'config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
  'sentencepiece.bpe.model', 'quant_config.json', 'onnx/model_uint8.onnx',
] as const;

export interface SemanticCacheSpec {
  model: string;
  revision: string;
  dtype: string;
  dimension: number;
  source?: 'modelscope' | 'huggingface';
  cachePath: string;
}

export interface ReceiptFile { path: string; size: number; sha256: string }
export interface SemanticModelReceipt {
  metadata_version?: number;
  model: string;
  revision: string;
  source?: 'modelscope' | 'huggingface';
  source_revision?: string;
  dtype: string;
  dimension: number;
  files: ReceiptFile[];
  cached_at: string;
  chunk_strategy?: string;
}

export function semanticReceiptPath(spec: SemanticCacheSpec): string {
  return path.join(spec.cachePath, SEMANTIC_RECEIPT_FILE);
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256FileSync(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead: number;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function semanticCacheIdentityMatches(value: SemanticModelReceipt, spec: SemanticCacheSpec): boolean {
  return value.model === spec.model
    && value.revision === spec.revision
    && value.dtype === spec.dtype
    && value.dimension === spec.dimension
    && Array.isArray(value.files)
    && value.files.length === REQUIRED_MODEL_FILES.length
    && (value.metadata_version ?? SEMANTIC_METADATA_VERSION) === SEMANTIC_METADATA_VERSION
    && (value.chunk_strategy ?? SEMANTIC_CHUNK_STRATEGY) === SEMANTIC_CHUNK_STRATEGY;
}

/**
 * Canonical model-cache integrity check used by both runtime commands and
 * synchronous project health verification. Download source is provenance only;
 * verified artifacts are shared across mirrors.
 */
export function inspectModelCacheSync(
  spec: SemanticCacheSpec,
): { integrity: 'ok' | 'missing' | 'corrupt'; cached: boolean } {
  let value: SemanticModelReceipt;
  try {
    value = JSON.parse(fs.readFileSync(semanticReceiptPath(spec), 'utf8'));
    const valid = semanticCacheIdentityMatches(value, spec);
    if (!valid) return { integrity: 'corrupt', cached: false };
  } catch (error: any) {
    return { integrity: error?.code === 'ENOENT' ? 'missing' : 'corrupt', cached: false };
  }
  try {
    for (const requiredPath of REQUIRED_MODEL_FILES) {
      const recorded = value.files.find(file => file.path === requiredPath);
      if (!recorded) return { integrity: 'corrupt', cached: false };
      const localPath = path.join(spec.cachePath, requiredPath);
      const stat = fs.statSync(localPath);
      if (!stat.isFile() || stat.size !== recorded.size || sha256FileSync(localPath) !== recorded.sha256) {
        return { integrity: 'corrupt', cached: false };
      }
    }
    const onnx = value.files.find(file => file.path === 'onnx/model_uint8.onnx');
    if (onnx?.sha256 !== MODEL_UINT8_SHA256) return { integrity: 'corrupt', cached: false };
    return { integrity: 'ok', cached: true };
  } catch {
    return { integrity: 'corrupt', cached: false };
  }
}

export async function inspectModelCache(
  spec: SemanticCacheSpec,
): Promise<{ integrity: 'ok' | 'missing' | 'corrupt'; cached: boolean }> {
  return inspectModelCacheSync(spec);
}
