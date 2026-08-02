/**
 * v1.2 runtime compatibility boundary.
 *
 * All legacy Card/Manifest/SQLite query and capture adapters are imported from
 * this module so the v1.3 Runtime implementation only sees canonical ports.
 */
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
