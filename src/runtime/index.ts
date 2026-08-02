import {
  askQuery,
  askQueryWithSemantic,
  captureCore,
  contextQuery,
  createOfflineTransformersProvider,
  getCurrentBranch,
  getSemanticStatus,
  inspectModelCache,
  loadManifest,
  recallQuery,
  relatedQuery,
  statusQuery,
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
} from '../compatibility/v1_2_runtime';
import { createDefaultRetrieverRegistry, createQueryPlan, type QueryExecutionResult } from '../query';
import type { DisposableEmbeddingProvider } from '../compatibility/v1_2_runtime';
import { loadRuntimeConfig } from './config';
import { PACKAGE_VERSION } from '../version';
import { EventStore } from './event-store';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { EMPTY_SCHEMA_REGISTRY, SqliteMemoryBackend, type SqliteDatabase } from '../storage/sqlite';
import { toPmemPath, type CapabilitySet, type CaptureOptions, type CaptureResult, type ContextQueryResult, type ForgetRequest, type MemoryBackend, type MemoryCapability, type MemoryEvent, type Observation, type PmemInstance, type PmemOpenOptions, type Receipt, type RecallOptions, type RecallQueryResult, type RelatedOptions, type RelatedResult, type RuntimeConfig, type SessionResult, type StatusOptions, type StatusResult } from './types';
import type { AskOptions, AskResultV03 } from '../compatibility/v1_2_runtime';

export class Pmem implements PmemInstance {
  readonly pmemPath: string;
  readonly backend: MemoryBackend;
  private db: SqliteDatabase;
  private readonly compatibilityBackend: SqliteMemoryBackend | null;
  private readonly scope: ScopeManager;
  private readonly policy: PolicyEngine;
  private events: EventStore;
  private readonly registeredCapabilities: CapabilitySet[];
  private readonly retrievers = createDefaultRetrieverRegistry();
  private closed = false;
  private semanticProvider: Promise<DisposableEmbeddingProvider> | null = null;

  static async open(opts: PmemOpenOptions): Promise<Pmem> {
    const config = loadRuntimeConfig(opts.root, opts.preset, opts.config);
    const pmemPath = toPmemPath(opts.root);
    const backend = opts.backend ?? new SqliteMemoryBackend(pmemPath);
    await backend.open({ root: opts.root, schema: opts.schema ?? EMPTY_SCHEMA_REGISTRY });

    // Existing v1.2 query/capture paths still require a SQLite handle. When a
    // non-SQLite backend is injected, keep a short-lived compatibility adapter
    // for those legacy paths until VS-2 migrates them onto MemoryBackend.
    let compatibilityBackend: SqliteMemoryBackend | null = null;
    let db = backend instanceof SqliteMemoryBackend ? backend.database : null;
    if (!db) {
      compatibilityBackend = new SqliteMemoryBackend(pmemPath);
      compatibilityBackend.open({ root: opts.root, schema: opts.schema ?? EMPTY_SCHEMA_REGISTRY });
      db = compatibilityBackend.database;
    }
    if (!db) throw new Error('SQLite compatibility backend failed to open.');
    return new Pmem(opts.root, pmemPath, config, db, backend, compatibilityBackend, opts.capabilities);
  }

  private constructor(
    readonly root: string,
    pmemPath: string,
    readonly config: RuntimeConfig,
    db: SqliteDatabase,
    backend: MemoryBackend,
    compatibilityBackend: SqliteMemoryBackend | null,
    capabilities?: CapabilitySet[],
  ) {
    this.pmemPath = pmemPath;
    this.db = db;
    this.backend = backend;
    this.compatibilityBackend = compatibilityBackend;
    this.scope = new ScopeManager(root, config);
    this.policy = new PolicyEngine(config, capabilities ?? []);
    this.events = new EventStore(db, config.working.ttl);
    this.registeredCapabilities = capabilities ?? [];
  }

  async ask(query: string, opts?: AskOptions): Promise<AskResultV03> {
    this.assertOpen();
    try {
      const registryResult = await this.executeQueryPlan(createQueryPlan(query, opts?.limit));
      // A non-SQLite backend has no legacy card/query engine to fall back to;
      // expose the backend-neutral result directly. SQLite keeps the mature
      // v1.2 ranking/diagnostic envelope while still executing the registry as
      // its capability-aware first pass.
      if (this.backend.id !== 'sqlite' && registryResult.hits.length > 0) {
        return this.registryAskResult(query, registryResult);
      }
      const deterministicOptions = { ...opts, now: opts?.now ?? Date.now(), db: this.db };
      let semantic: ReturnType<Pmem['semanticConfig']>;
      try {
        semantic = this.semanticConfig();
      } catch (error: any) {
        return {
          ...askQuery(this.pmemPath, query, deterministicOptions),
          warnings: [`Semantic retrieval degraded to deterministic recall: ${error?.message ?? String(error)}`],
        };
      }
      if (!semantic) return askQuery(this.pmemPath, query, deterministicOptions);
      const semanticStatus = getSemanticStatus(this.db);
      if (!semanticStatus.available) {
        const detail = semanticStatus.compatible
          ? 'the derived index is unavailable'
          : `the derived index uses pipeline v${semanticStatus.pipelineVersion ?? 1}, but v2 is required`;
        return {
          ...askQuery(this.pmemPath, query, deterministicOptions),
          warnings: [`Semantic retrieval is enabled but ${detail}. Run \`pmem semantic rebuild\`.`],
        };
      }
      try {
        const provider = await this.getSemanticProvider(semantic);
        return await askQueryWithSemantic(this.pmemPath, query, provider, deterministicOptions);
      } catch (error: any) {
        return {
          ...askQuery(this.pmemPath, query, deterministicOptions),
          warnings: [`Semantic retrieval degraded to deterministic recall: ${error?.message ?? String(error)}`],
        };
      }
    } finally {
      // Pmem owns this DB; read helpers must not close it.
    }
  }

  async query(query: string, limit?: number): Promise<QueryExecutionResult> {
    return this.executeQueryPlan(createQueryPlan(query, limit));
  }

  async executeQueryPlan(plan: import('../query').QueryPlan): Promise<QueryExecutionResult> {
    this.assertOpen();
    return this.retrievers.execute({ backend: this.backend, plan });
  }

  async recall(opts?: RecallOptions): Promise<RecallQueryResult> {
    this.assertOpen();
    try {
      return recallQuery(this.pmemPath, { ...opts, db: this.db, cwd: this.root });
    } finally {
      // Pmem owns this DB; read helpers must not close it.
    }
  }

  async context(task: string, budget?: number): Promise<ContextQueryResult> {
    this.assertOpen();
    try {
      const result = contextQuery(this.pmemPath, task, budget, this.db, this.root);
      const manifest = loadManifest(this.pmemPath);
      if (!manifest || !('embedding' in manifest) || !manifest.embedding.enabled) return result;
      const ask = await this.ask(task, { explain: true, limit: 12 });
      result.relevant_memory = ask.matched.slice(0, 10).map(match => {
        const row = this.db.prepare(
          'SELECT type, title, summary, file_path FROM cards WHERE id = ? AND is_deleted = 0'
        ).get(match.id) as { type: string; title: string; summary: string | null; file_path: string };
        return {
          id: match.id,
          title: row.title,
          file_path: row.file_path,
          summary: row.summary ?? undefined,
          type: row.type,
          score: match.score,
          reason: match.reasons?.map(reason => reason.channel).join(', ') || match.match_type,
          stale: match.stale,
        };
      });
      if (ask.warnings) result.warnings.push(...ask.warnings);
      for (const card of result.relevant_memory.slice(0, 3)) {
        if (!result.must_read.some(item => item.path === card.file_path)) {
          result.must_read.push({ path: card.file_path, reason: `Task-relevant memory card: ${card.id} (${card.type})` });
        }
      }
      return result;
    } finally {
      // Pmem owns this DB; read helpers must not close it.
    }
  }

  async related(id: string, opts?: RelatedOptions): Promise<RelatedResult> {
    this.assertOpen();
    try {
      return relatedQuery(this.pmemPath, id, { ...opts, db: this.db });
    } finally {
      // Pmem owns this DB; read helpers must not close it.
    }
  }

  async status(opts?: StatusOptions): Promise<StatusResult> {
    this.assertOpen();
    try {
      return statusQuery(this.pmemPath, { ...opts, db: this.db, cwd: this.root });
    } finally {
      // Pmem owns this DB; read helpers must not close it.
    }
  }

  async observe(change: Observation): Promise<Receipt> {
    this.assertOpen();
    const principal = (change.metadata?.principal as string) ?? 'default';
    const scope = this.scope.resolve(change.file ?? '', change);
    // Capability check before quota so a denied op does not consume quota.
    this.requireCapability(principal, 'memory.observe', scope);
    const quotaCheck = this.policy.checkQuota(principal, 'observe');
    if (!quotaCheck.allowed) throw new Error(`QuotaExceededError: observation quota exceeded for ${principal}`);
    const proposal = {
      type: 'observe' as const,
      scope,
      summary: change.summary,
      file: change.file,
      metadata: change.metadata,
    };
    const requiresConfirmation = this.policy.requiresConfirmation(proposal);
    const event = await this.withBackendTransaction(async tx => tx.appendEvent({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'observe',
      scope,
      created_at: change.at ?? new Date().toISOString(),
      payload: {
        file: change.file,
        summary: change.summary,
        action: change.action,
        metadata: change.metadata,
      },
    }));
    return {
      id: event.id,
      type: event.type,
      scope: event.scope,
      created_at: event.created_at,
      requires_confirmation: requiresConfirmation,
    };
  }

  async forget(request: ForgetRequest): Promise<Receipt> {
    this.assertOpen();
    const principal = (request.metadata?.principal as string) ?? 'default';
    const target = this.events.find(request.id);
    const scope = target?.scope ?? this.scope.resolve('', { metadata: request.metadata });
    this.requireCapability(principal, 'memory.forget', scope);
    const requiresConfirmation = this.policy.requiresConfirmation({
      type: 'forget',
      scope,
      summary: request.reason,
      metadata: request.metadata,
    });
    const durableRecord = await this.backend.getRecord(request.id);
    const durable = durableRecord
      ? await this.withBackendTransaction(async tx => {
          const event: MemoryEvent = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: 'forget',
            scope,
            created_at: request.at ?? new Date().toISOString(),
            payload: { target_id: request.id, reason: request.reason, metadata: request.metadata },
            record_id: request.id,
          };
          await tx.deleteRecord(request.id, event);
          return { success: true, memoryId: request.id, message: `Memory forgotten: ${request.id}` };
        })
      : { success: false, memoryId: request.id, message: `Memory not found: ${request.id}` };
    // `forget` accepts either a durable card ID or an existing runtime event
    // ID. A target that is neither must not create a success-shaped tombstone:
    // that would turn a typo into misleading history. Existing event IDs still
    // use the EventStore tombstone path for backward compatibility.
    if (!durable.success && !target) {
      throw new Error(durable.message);
    }
    let event: MemoryEvent;
    if (durable.success) {
      event = this.events.replay().filter(candidate =>
        candidate.type === 'forget' && candidate.payload.target_id === request.id
      ).at(-1) ?? {
        id: request.id,
        type: 'forget',
        scope,
        created_at: request.at ?? new Date().toISOString(),
        payload: { target_id: request.id, reason: request.reason, metadata: request.metadata, durable: true },
      };
    } else if (target) {
      event = await this.withBackendTransaction(async tx => tx.appendEvent({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'forget',
        scope,
        created_at: request.at ?? new Date().toISOString(),
        payload: {
          target_id: request.id,
          reason: request.reason,
          metadata: request.metadata,
          durable: false,
          error: durable.message,
        },
      }));
    } else {
      throw new Error(durable.message);
    }
    return {
      id: event.id,
      type: event.type,
      scope: event.scope,
      created_at: event.created_at,
      requires_confirmation: requiresConfirmation,
    };
  }

  async capture(summary: string, opts: CaptureOptions = {}): Promise<CaptureResult> {
    this.assertOpen();
    const principal = ((opts as Record<string, unknown>).principal as string) ?? 'default';
    const captureSummary = summary || opts.summary || '';
    const scope = this.scope.resolve((opts as Record<string, unknown>).file as string ?? '', { summary: captureSummary });
    // Capability check before quota so a denied op does not consume quota.
    this.requireCapability(principal, 'memory.commit', scope);
    const quotaCheck = this.policy.checkQuota(principal, 'capture');
    if (!quotaCheck.allowed) throw new Error(`QuotaExceededError: capture quota exceeded for ${principal}`);
    // captureCore is a filesystem Projection workflow. It owns its rebuild
    // and journal/rollback boundaries, so holding the backend SQL lock across
    // it would deadlock the legacy rebuild connection. Complete the projection
    // first, then commit its canonical lifecycle event through the backend.
    const result = captureCore(this.pmemPath, {
      ...opts,
      summary: captureSummary || undefined,
      cwd: this.root,
      deferRuntimeEvent: true,
    });
    if (!result.success) return result;
    return this.withBackendTransaction(async tx => {
      await tx.appendEvent({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'commit',
        scope,
        created_at: new Date().toISOString(),
        payload: {
          trace_path: result.tracePath,
          summary: captureSummary,
          branch: getCurrentBranch(this.root) ?? undefined,
        },
      });
      return result;
    });
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    await this.withBackendTransaction(async tx => tx.appendEvent({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'session_end',
      scope,
      created_at: new Date().toISOString(),
      payload: { result },
    }));
    this.events.expire();
  }

  async mergeBranchMemory(sourceBranch: string, targetBranch: string = 'main', principal: string = 'default'): Promise<number> {
    this.assertOpen();
    // Cross-scope migration is a privileged operation: require admin.
    this.requireCapability(principal, 'memory.admin', `branch:${targetBranch}`);
    return this.events.mergeBranch(sourceBranch, targetBranch);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.semanticProvider) {
      try { await (await this.semanticProvider).dispose(); } catch {}
      this.semanticProvider = null;
    }
    if (this.compatibilityBackend) this.compatibilityBackend.close();
    await this.backend.close();
    this.closed = true;
  }

  private requireCapability(principal: string, capability: MemoryCapability, scope: string): void {
    if (this.registeredCapabilities.length === 0) return;
    // Authorize the *calling* principal only. Granting because some other
    // registered principal holds the capability would defeat isolation.
    if (this.policy.checkCapability(principal, capability, scope)) return;
    throw new Error(
      `Operation requires capability '${capability}' on scope '${scope}', but principal '${principal}' does not have it.`
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Pmem instance is already closed.');
  }

  private async withBackendTransaction<T>(work: (tx: import('./model').BackendTransaction) => T | PromiseLike<T>): Promise<T> {
    const tx = await this.backend.beginTransaction();
    try {
      const result = await work(tx);
      await tx.commit();
      return result;
    } catch (error) {
      try { await tx.rollback(error); } catch {}
      throw error;
    }
  }

  private registryAskResult(query: string, result: QueryExecutionResult): AskResultV03 {
    const matched = result.hits.map(hit => {
      const data = hit.record?.data ?? {};
      const file = typeof data.file_path === 'string' ? data.file_path : '';
      const title = typeof data.title === 'string' ? data.title : hit.id;
      return {
        id: hit.id,
        title,
        match_type: 'keyword_fallback' as const,
        confidence: Math.max(0, Math.min(1, hit.score)),
        graph_distance: hit.channels.includes('graph') ? 1 : 0,
        file,
        score: hit.score,
        reasons: hit.channels.map(channel => ({ channel, detail: `backend retriever: ${channel}`, base: hit.score })) as any,
      };
    });
    return {
      query,
      matched,
      recommended_files: matched.map(item => item.file).filter(Boolean),
      evidence_paths: matched.map(item => item.file).filter(Boolean),
      warnings: result.warnings ? [...result.warnings] : undefined,
    };
  }

  private semanticConfig(): {
    model: string;
    revision: string;
    dtype: 'uint8';
    dimension: number;
    source: 'modelscope' | 'huggingface';
    cachePath: string;
  } | null {
    const manifest = loadManifest(this.pmemPath);
    const embedding = manifest && 'embedding' in manifest ? manifest.embedding : null;
    if (!embedding?.enabled) return null;
    if (
      embedding.provider !== 'local'
      || embedding.model !== DEFAULT_SEMANTIC_MODEL
      || embedding.revision !== DEFAULT_SEMANTIC_MODEL_REVISION
      || embedding.dtype !== DEFAULT_SEMANTIC_DTYPE
      || embedding.dimension !== DEFAULT_SEMANTIC_DIMENSION
      || (embedding.source !== 'modelscope' && embedding.source !== 'huggingface')
      || !embedding.cache_path
    ) {
      throw new Error(`Semantic manifest configuration is incompatible with ${PACKAGE_VERSION}. Run \`pmem semantic setup\`.`);
    }
    return {
      model: embedding.model,
      revision: embedding.revision,
      dtype: embedding.dtype,
      dimension: embedding.dimension,
      source: embedding.source,
      cachePath: embedding.cache_path,
    };
  }

  private async getSemanticProvider(spec: ReturnType<Pmem['semanticConfig']>): Promise<DisposableEmbeddingProvider> {
    if (!spec) throw new Error('Semantic retrieval is disabled.');
    if (!this.semanticProvider) {
      const cache = await inspectModelCache(spec);
      if (!cache.cached) {
        throw new Error(`Semantic model cache is ${cache.integrity}. Re-run \`pmem semantic setup\` while online.`);
      }
      this.semanticProvider = createOfflineTransformersProvider(spec);
    }
    return this.semanticProvider;
  }

}

export * from './model';
export * from './types';
export { loadRuntimeConfig, PRESET_DEFAULTS } from './config';
export { ScopeManager } from './scope';
export { PolicyEngine } from './policy';
export { EventStore } from './event-store';
export { SqliteMemoryBackend } from '../storage/sqlite';
export {
  createDefaultRetrieverRegistry,
  createQueryPlan,
  RetrieverRegistry,
} from '../query';
export type {
  QueryExecutionResult,
  QueryPlan,
  QueryStage,
  Retriever,
  RetrieverContext,
  RetrieverHit,
  RetrieverId,
  RetrieverResult,
} from '../query';
