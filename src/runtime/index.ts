import { createDefaultRetrieverRegistry, createQueryPlan, type QueryExecutionResult } from '../query';
import { packContext as buildContextPack, type ContextPack, type ContextPackJsonValue, type PackContextOptions } from '../context-pack';
import { loadRuntimeConfig } from './config';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { memoryScopeId } from './model';
import { randomUUID } from 'node:crypto';
import { toPmemPath, type AskOptions, type AskResultV03, type CapabilitySet, type CaptureOptions, type CaptureResult, type ContextQueryResult, type ForgetRequest, type MemoryBackend, type MemoryCapability, type MemoryEvent, type Observation, type PmemInstance, type PmemOpenOptions, type Receipt, type RecallOptions, type RecallQueryResult, type RelatedOptions, type RelatedResult, type RuntimeConfig, type RuntimeLegacyAdapter, type SessionResult, type StatusOptions, type StatusResult } from './types';

export class Pmem implements PmemInstance {
  readonly pmemPath: string;
  readonly backend: MemoryBackend;
  private readonly scope: ScopeManager;
  private readonly policy: PolicyEngine;
  private readonly legacy: RuntimeLegacyAdapter | undefined;
  private readonly registeredCapabilities: CapabilitySet[];
  private readonly retrievers = createDefaultRetrieverRegistry();
  private closed = false;

  static async open(opts: PmemOpenOptions): Promise<Pmem> {
    const config = loadRuntimeConfig(opts.preset, opts.config);
    const pmemPath = toPmemPath(opts.root);
    if (!opts.backend) {
      throw new Error('Pmem.open requires an explicit MemoryBackend. Use the v1.2 compatibility entrypoint for the default SQLite project adapter.');
    }
    await opts.backend.open({ root: opts.root, schema: opts.schema ?? { resolve: async ref => ({ ref, fields: [] }), list: async () => [] } });
    return new Pmem(opts.root, pmemPath, config, opts.backend, opts.legacy, opts.capabilities);
  }

  private constructor(
    readonly root: string,
    pmemPath: string,
    readonly config: RuntimeConfig,
    backend: MemoryBackend,
    legacy: RuntimeLegacyAdapter | undefined,
    capabilities?: CapabilitySet[],
  ) {
    this.pmemPath = pmemPath;
    this.backend = backend;
    this.legacy = legacy;
    this.scope = new ScopeManager(root, config);
    this.policy = new PolicyEngine(config, capabilities ?? []);
    this.registeredCapabilities = capabilities ?? [];
  }

  async ask(query: string, opts?: AskOptions): Promise<AskResultV03> {
    this.assertOpen();
    if (this.legacy) return this.legacy.ask(query, opts);
    return this.registryAskResult(query, await this.executeQueryPlan(createQueryPlan(query, opts?.limit)));
  }

  async query(query: string, limit?: number): Promise<QueryExecutionResult> {
    return this.executeQueryPlan(createQueryPlan(query, limit));
  }

  async packContext(query: string, options: PackContextOptions = {}): Promise<ContextPack> {
    this.assertOpen();
    const result = await this.query(query, options.maxRecords);
    const records = result.hits.flatMap(hit => {
      if (!hit.record) return [];
      const data = hit.record.data;
      const content = typeof data.content === 'string'
        ? data.content
        : typeof data.body === 'string'
          ? data.body
          : typeof data.summary === 'string'
            ? data.summary
            : JSON.stringify(data);
      const title = typeof data.title === 'string' ? data.title : undefined;
      const sourceId = hit.record.provenance.source_id;
      return [{
        id: hit.record.id,
        content,
        title,
        type: typeof data.type === 'string' ? data.type : undefined,
        score: hit.score,
        source: sourceId ? { path: sourceId } : undefined,
        metadata: { channels: [...hit.channels] },
      }];
    });
    const evidence = result.hits.flatMap(hit => {
      if (!hit.evidence) return [];
      const semantic = hit.evidence;
      const location = semantic.headingPath.length > 0
        ? semantic.headingPath.join(' > ')
        : semantic.chunkId;
      return [{
        id: semantic.chunkId,
        recordId: hit.id,
        kind: 'semantic',
        content: `Semantic match at ${location}`,
        score: semantic.similarity,
        metadata: {
          semanticEvidence: JSON.parse(JSON.stringify(semantic)) as ContextPackJsonValue,
        },
      }];
    });
    return buildContextPack({
      query,
      records,
      evidence,
      provenance: {
        executed: [...result.executed],
        skipped: [...result.skipped],
        warnings: [...(result.warnings ?? [])],
      },
    }, options);
  }

  async executeQueryPlan(plan: import('../query').QueryPlan): Promise<QueryExecutionResult> {
    this.assertOpen();
    return this.retrievers.execute({ backend: this.backend, plan });
  }

  async recall(opts?: RecallOptions): Promise<RecallQueryResult> {
    this.assertOpen();
    return this.requireLegacy('recall').recall(opts);
  }

  async context(task: string, budget?: number): Promise<ContextQueryResult> {
    this.assertOpen();
    return this.requireLegacy('context').context(task, budget);
  }

  async related(id: string, opts?: RelatedOptions): Promise<RelatedResult> {
    this.assertOpen();
    return this.requireLegacy('related').related(id, opts);
  }

  async status(opts?: StatusOptions): Promise<StatusResult> {
    this.assertOpen();
    return this.requireLegacy('status').status(opts);
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
      id: randomUUID(),
      type: 'observe',
      scope,
      occurred_at: change.at ?? new Date().toISOString(),
      recorded_at: new Date().toISOString(),
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
      scope: memoryScopeId(event.scope),
      created_at: event.occurred_at,
      requires_confirmation: requiresConfirmation,
    };
  }

  async forget(request: ForgetRequest): Promise<Receipt> {
    this.assertOpen();
    const principal = (request.metadata?.principal as string) ?? 'default';
    const target = this.legacy?.findEvent(request.id) ?? null;
    const scope = target?.scope ?? this.scope.resolve('', { metadata: request.metadata });
    this.requireCapability(principal, 'memory.forget', scope);
    const requiresConfirmation = this.policy.requiresConfirmation({
      type: 'forget',
      scope: memoryScopeId(scope),
      summary: request.reason,
      metadata: request.metadata,
    });
    const durableRecord = await this.backend.getRecord(request.id);
    const durable = durableRecord
      ? await this.withBackendTransaction(async tx => {
          const event: MemoryEvent = {
            id: randomUUID(),
            type: 'forget',
            scope,
            occurred_at: request.at ?? new Date().toISOString(),
            recorded_at: new Date().toISOString(),
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
      event = {
        id: request.id,
        type: 'forget',
        scope,
        occurred_at: request.at ?? new Date().toISOString(),
        recorded_at: new Date().toISOString(),
        payload: { target_id: request.id, reason: request.reason, metadata: request.metadata, durable: true },
      };
    } else if (target) {
      event = await this.withBackendTransaction(async tx => tx.appendEvent({
        id: randomUUID(),
        type: 'forget',
        scope,
        occurred_at: request.at ?? new Date().toISOString(),
        recorded_at: new Date().toISOString(),
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
      scope: memoryScopeId(event.scope),
      created_at: event.occurred_at,
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
    const result = await this.requireLegacy('capture').capture(captureSummary, opts);
    if (!result.success) return result;
    const committed = await this.withBackendTransaction(async tx => {
      await tx.appendEvent({
        id: randomUUID(),
        type: 'commit',
        scope,
        occurred_at: new Date().toISOString(),
        recorded_at: new Date().toISOString(),
        payload: {
          trace_path: result.tracePath,
          summary: captureSummary,
          branch: (result as any).branch,
        },
      });
      return result;
    });
    if (this.legacy?.refreshSemanticIndex) {
      try {
        const semantic = await this.legacy.refreshSemanticIndex('incremental');
        return { ...committed, semantic };
      } catch (error: any) {
        // Semantic indexing is a derived perception channel. A missing model,
        // companion, or transient inference failure must never roll back the
        // canonical capture that already committed.
        return { ...committed, semantic: { status: 'degraded', reason: error?.message ?? String(error) } };
      }
    }
    return committed;
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    await this.withBackendTransaction(async tx => tx.appendEvent({
      id: randomUUID(),
      type: 'session_end',
      scope,
      occurred_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      payload: { result },
    }));
    this.legacy?.expireEvents();
  }

  async mergeBranchMemory(sourceBranch: string, targetBranch: string = 'main', principal: string = 'default'): Promise<number> {
    this.assertOpen();
    // Cross-scope migration is a privileged operation: require admin.
    this.requireCapability(principal, 'memory.admin', `branch:${targetBranch}`);
    return this.requireLegacy('mergeBranchMemory').mergeBranchMemory(sourceBranch, targetBranch);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.backend.close();
    this.closed = true;
  }

  private requireCapability(principal: string, capability: MemoryCapability, scope: import('./model').MemoryScope): void {
    if (this.registeredCapabilities.length === 0) return;
    // Authorize the *calling* principal only. Granting because some other
    // registered principal holds the capability would defeat isolation.
    if (this.policy.checkCapability(principal, capability, memoryScopeId(scope))) return;
    throw new Error(
      `Operation requires capability '${capability}' on scope '${memoryScopeId(scope)}', but principal '${principal}' does not have it.`
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

  private requireLegacy(operation: string): RuntimeLegacyAdapter {
    if (this.legacy) return this.legacy;
    throw new Error(`LegacyCompatibilityRequired: '${operation}' requires an explicit v1.2 adapter. Use the compatibility entrypoint or call backend-neutral Runtime APIs.`);
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
