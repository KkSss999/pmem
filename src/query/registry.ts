import type {
  BackendQuery,
  MemoryBackend,
  MemoryRecord,
  MemorySearchHit,
  MemorySearchResult,
} from '../runtime/model';

export type RetrieverId = 'structured' | 'exact' | 'lexical' | 'graph' | 'semantic';
export type QueryStage = RetrieverId | 'rerank' | 'packing';

export interface QueryPlan {
  text: string;
  stages: readonly QueryStage[];
  limit: number;
  deterministic: boolean;
}

export interface RetrieverContext {
  backend: MemoryBackend;
  plan: QueryPlan;
}

export interface RetrieverHit {
  id: string;
  score: number;
  channels: readonly string[];
  record?: MemoryRecord;
}

export interface RetrieverResult {
  hits: readonly RetrieverHit[];
  warnings?: readonly string[];
}

export interface Retriever {
  readonly id: RetrieverId;
  supports(backend: MemoryBackend): boolean;
  retrieve(context: RetrieverContext): Promise<RetrieverResult>;
}

export interface QueryExecutionResult extends RetrieverResult {
  executed: readonly QueryStage[];
  skipped: readonly QueryStage[];
}

export function createQueryPlan(text: string, limit = 20): QueryPlan {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20;
  return {
    text: text.trim(),
    stages: ['exact', 'structured', 'lexical', 'graph', 'semantic', 'rerank', 'packing'],
    limit: Math.min(100, Math.max(1, requestedLimit)),
    deterministic: true,
  };
}

/**
 * Backend-neutral retriever orchestration. Unsupported channels are skipped
 * and failures degrade to the next deterministic channel instead of failing
 * the whole query.
 */
export class RetrieverRegistry {
  private readonly retrievers = new Map<RetrieverId, Retriever>();

  register(retriever: Retriever): this {
    this.retrievers.set(retriever.id, retriever);
    return this;
  }

  unregister(id: RetrieverId): boolean {
    return this.retrievers.delete(id);
  }

  list(): readonly RetrieverId[] {
    return [...this.retrievers.keys()];
  }

  async execute(context: RetrieverContext): Promise<QueryExecutionResult> {
    const merged = new Map<string, RetrieverHit>();
    const warnings: string[] = [];
    const executed: QueryStage[] = [];
    const skipped: QueryStage[] = [];
    for (const stage of context.plan.stages) {
      if (stage === 'rerank') {
        executed.push(stage);
        continue;
      }
      if (stage === 'packing') {
        executed.push(stage);
        continue;
      }
      const retriever = this.retrievers.get(stage);
      if (!retriever) {
        skipped.push(stage);
        continue;
      }
      let supported = false;
      try {
        supported = retriever.supports(context.backend);
      } catch (error: unknown) {
        skipped.push(stage);
        warnings.push(`${stage} retriever skipped: capability check failed (${errorMessage(error)})`);
        continue;
      }
      if (!supported) {
        skipped.push(stage);
        // Graph is special: silently pretending that a relation channel ran
        // is misleading.  Other channels are intentionally quiet because a
        // backend may legitimately omit optional indexes.
        if (stage === 'graph') {
          warnings.push('graph retriever skipped: backend does not support relation queries');
        }
        continue;
      }
      executed.push(stage);
      try {
        const result = await retriever.retrieve(context);
        warnings.push(...(result.warnings ?? []));
        for (const hit of result.hits) {
          const existing = merged.get(hit.id);
          merged.set(hit.id, mergeHits(existing, hit));
        }
      } catch (error: unknown) {
        warnings.push(`${stage} retriever degraded: ${errorMessage(error)}`);
      }
    }
    let hits = [...merged.values()];
    if (context.plan.stages.includes('rerank')) {
      const channelWeight: Record<string, number> = { exact: 1, structured: 0.9, lexical: 0.8, graph: 0.7, semantic: 0.6 };
      hits = hits.sort((a, b) =>
      (b.score + channelBonus(b.channels, channelWeight))
        - (a.score + channelBonus(a.channels, channelWeight))
        || a.id.localeCompare(b.id)
      );
    } else {
      hits = hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
    if (context.plan.stages.includes('packing')) hits = hits.slice(0, context.plan.limit);
    return { hits, warnings: warnings.length > 0 ? warnings : undefined, executed, skipped };
  }
}

export function createDefaultRetrieverRegistry(): RetrieverRegistry {
  return new RetrieverRegistry()
    .register(exactRetriever)
    .register(structuredRetriever)
    .register(lexicalRetriever)
    .register(graphRetriever)
    .register(semanticRetriever);
}

const exactRetriever: Retriever = {
  id: 'exact',
  supports: backend => backend.capabilities.query.structured,
  async retrieve({ backend, plan }) {
    const query: BackendQuery = { filters: [{ field: 'id', operator: 'eq', value: plan.text }], limit: plan.limit };
    const result = await backend.query(query);
    return { hits: result.records.map(record => toHit(record, 1, 'exact')) };
  },
};

const structuredRetriever: Retriever = {
  id: 'structured',
  supports: backend => backend.capabilities.query.structured,
  async retrieve({ backend, plan }) {
    const query: BackendQuery = { filters: [{ field: 'title', operator: 'contains', value: plan.text }], limit: plan.limit };
    const result = await backend.query(query);
    return { hits: result.records.map(record => toHit(record, 0.8, 'structured')) };
  },
};

const lexicalRetriever: Retriever = {
  id: 'lexical',
  supports: backend => backend.capabilities.query.fulltext || backend.capabilities.search_index,
  async retrieve({ backend, plan }) {
    const result: MemorySearchResult = await backend.search({ text: plan.text, limit: plan.limit });
    return { hits: await Promise.all(result.hits.map(hit => toSearchHit(backend, hit, 'lexical'))) };
  },
};

const graphRetriever: Retriever = {
  id: 'graph',
  supports: backend => backend.capabilities.query.graph && backend.capabilities.relations,
  async retrieve({ backend, plan }) {
    try {
      const result = await backend.query({ relation: { from_id: plan.text, depth: 1 }, limit: plan.limit });
      return { hits: result.records.map(record => toHit(record, 0.6, 'graph')) };
    } catch (error: unknown) {
      // A backend may advertise the general graph capability while omitting
      // relation traversal in a particular deployment.  Do not manufacture
      // graph records; surface a deterministic skip/degradation warning.
      return {
        hits: [],
        warnings: [`graph retriever skipped: relation query unavailable (${errorMessage(error)})`],
      };
    }
  },
};

const semanticRetriever: Retriever = {
  id: 'semantic',
  supports: backend => backend.capabilities.query.semantic,
  async retrieve({ backend, plan }) {
    const result = await backend.search({ text: plan.text, limit: plan.limit });
    return { hits: await Promise.all(result.hits.map(hit => toSearchHit(backend, hit, 'semantic'))) };
  },
};

function toHit(record: MemoryRecord, score: number, channel: string): RetrieverHit {
  return { id: record.id, score, channels: [channel], record };
}

async function toSearchHit(backend: MemoryBackend, hit: MemorySearchHit, channel: string): Promise<RetrieverHit> {
  let record: MemoryRecord | undefined;
  try {
    record = (await backend.getRecord(hit.record_id)) ?? undefined;
  } catch {
    // Search results remain useful when a backend cannot hydrate a document.
  }
  return { id: hit.record_id, score: finiteScore(hit.score), channels: [channel, ...(hit.channels ?? [])], record };
}

function mergeHits(existing: RetrieverHit | undefined, incoming: RetrieverHit): RetrieverHit {
  if (!existing) return { ...incoming, score: finiteScore(incoming.score), channels: [...new Set(incoming.channels)] };
  const channels = [...new Set([...existing.channels, ...incoming.channels])];
  const incomingWins = finiteScore(incoming.score) > finiteScore(existing.score);
  const winner = incomingWins ? incoming : existing;
  return {
    ...winner,
    score: finiteScore(winner.score),
    channels,
    // Hydration is best-effort; retain a record supplied by either channel.
    record: winner.record ?? existing.record ?? incoming.record,
  };
}

function channelBonus(channels: readonly string[], weights: Readonly<Record<string, number>>): number {
  return Math.max(0, ...channels.map(channel => weights[channel] ?? 0)) * 0.01;
}

function finiteScore(score: number): number {
  return Number.isFinite(score) ? score : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
