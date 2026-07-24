import * as path from 'node:path';
import type { Manifest, VerifyIssue } from '../../types';
import { closeDatabase, openOwnedDatabase } from '../db';
import { chunkCard } from '../semantic/chunks';
import { inspectModelCacheSync } from '../semantic/cache';
import { loadSemanticProjectDocuments, getSemanticProjectStatus } from '../semantic/project';
import { filterSafeSemanticCards, semanticExclusionReason, type SemanticExclusionReason } from '../semantic/safety';

export interface SemanticReadinessResult {
  applicable: boolean;
  eligible_cards: number;
  excluded_cards: number;
  excluded_by_reason: Partial<Record<SemanticExclusionReason, number>>;
  pipeline_version: number | null;
  index_compatible: boolean;
  index_fresh: boolean;
  issues: VerifyIssue[];
}

export function summarizeSemanticEligibility(documents: ReturnType<typeof loadSemanticProjectDocuments>): {
  eligible_cards: number;
  excluded_cards: number;
  excluded_by_reason: Partial<Record<SemanticExclusionReason, number>>;
} {
  const excludedByReason: Partial<Record<SemanticExclusionReason, number>> = {};
  let eligibleCards = 0;
  for (const document of documents) {
    const reason = semanticExclusionReason(document);
    if (reason) excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
    else eligibleCards++;
  }
  return {
    eligible_cards: eligibleCards,
    excluded_cards: documents.length - eligibleCards,
    excluded_by_reason: excludedByReason,
  };
}

function semanticIssue(type: string, message: string, fix: string): VerifyIssue {
  return { severity: 'warning', type, message, fix, dimension: 'semantic_readiness' };
}

export function inspectSemanticReadiness(pmemPath: string, manifest: Manifest): SemanticReadinessResult {
  if (!('embedding' in manifest) || !manifest.embedding.enabled) {
    return {
      applicable: false, eligible_cards: 0, excluded_cards: 0, excluded_by_reason: {},
      pipeline_version: null, index_compatible: false, index_fresh: false, issues: [],
    };
  }
  const config = manifest.embedding;
  const issues: VerifyIssue[] = [];
  const documents = loadSemanticProjectDocuments(pmemPath);
  const safe = filterSafeSemanticCards(documents);
  const eligibility = summarizeSemanticEligibility(documents);
  const excludedByReason = eligibility.excluded_by_reason;
  let pipelineVersion: number | null = null;
  let indexCompatible = false;
  let indexFresh = false;
  if (!config.model || !config.revision || !config.dtype || !config.dimension || !config.cache_path || !path.isAbsolute(config.cache_path)) {
    issues.push(semanticIssue('semantic_config_invalid', 'Semantic retrieval is enabled but its manifest configuration is incomplete.', 'Run: pmem semantic setup'));
    return {
      applicable: true, eligible_cards: safe.length, excluded_cards: documents.length - safe.length,
      excluded_by_reason: excludedByReason, pipeline_version: null, index_compatible: false, index_fresh: false, issues,
    };
  }
  const spec = { model: config.model, revision: config.revision, dtype: config.dtype, dimension: config.dimension, source: config.source ?? undefined, cachePath: config.cache_path };
  const cache = inspectModelCacheSync(spec);
  if (cache.integrity !== 'ok') {
    issues.push(semanticIssue(
      cache.integrity === 'missing' ? 'semantic_cache_missing' : 'semantic_cache_corrupt',
      'The configured global semantic model cache is missing or does not match its receipt.',
      'Run: pmem semantic setup',
    ));
  }
  try {
    const status = getSemanticProjectStatus(pmemPath);
    pipelineVersion = status.pipelineVersion;
    indexCompatible = status.pipelineVersion !== null && status.compatible;
    if (!status.available) {
      issues.push(semanticIssue('semantic_index_unavailable', 'Semantic retrieval is enabled but no compatible complete index is available.', 'Run: pmem semantic rebuild --full'));
    }
    if (status.pipelineVersion !== null && (status.modelId !== config.model || status.revision !== config.revision || status.dimension !== config.dimension)) {
      issues.push(semanticIssue('semantic_index_model_mismatch', 'Semantic index model metadata differs from the manifest.', 'Run: pmem semantic rebuild --full'));
    }
    if (status.available) {
      const expected = new Map(safe.flatMap(card => chunkCard(card)).map(chunk => [chunk.chunkId, `${chunk.contentHash}:${chunk.contextHash}`]));
      const db = openOwnedDatabase(pmemPath);
      try {
        const stored = db.prepare('SELECT chunk_id, content_hash, context_hash FROM semantic_chunks').all() as Array<{ chunk_id: string; content_hash: string; context_hash: string }>;
        indexFresh = stored.length === expected.size
          && stored.every(row => expected.get(row.chunk_id) === `${row.content_hash}:${row.context_hash}`);
        if (!indexFresh) issues.push(semanticIssue('semantic_index_stale', 'Semantic index content does not match the current safe card and context snapshot.', 'Run: pmem semantic rebuild'));
      } finally {
        closeDatabase(db);
      }
    }
  } catch {
    issues.push(semanticIssue('semantic_index_unavailable', 'Semantic index could not be inspected.', 'Run: pmem rebuild && pmem semantic rebuild --full'));
  }
  return {
    applicable: true,
    eligible_cards: safe.length,
    excluded_cards: documents.length - safe.length,
    excluded_by_reason: excludedByReason,
    pipeline_version: pipelineVersion,
    index_compatible: indexCompatible,
    index_fresh: indexFresh,
    issues,
  };
}
