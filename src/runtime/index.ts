import Database from 'better-sqlite3';
import { askQuery, askQueryWithSemantic } from '../core/query/ask';
import { recallQuery } from '../core/query/recall';
import { contextQuery } from '../core/query/context';
import { relatedQuery } from '../core/query/related';
import { statusQuery } from '../core/query/status';
import { captureCore } from '../core/capture';
import { createSchema, forgetMemory, openOwnedDatabase } from '../core/db';
import { loadManifest } from '../core/manifest';
import {
  createOfflineTransformersProvider,
  DEFAULT_SEMANTIC_DIMENSION,
  DEFAULT_SEMANTIC_DTYPE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_REVISION,
  getSemanticStatus,
  inspectModelCache,
  type DisposableEmbeddingProvider,
} from '../core/semantic';
import { loadRuntimeConfig } from './config';
import { EventStore } from './event-store';
import { PolicyEngine } from './policy';
import { ScopeManager } from './scope';
import { toPmemPath, type CapabilitySet, type CaptureOptions, type CaptureResult, type ContextQueryResult, type ForgetRequest, type MemoryCapability, type Observation, type PmemInstance, type PmemOpenOptions, type Receipt, type RecallOptions, type RecallQueryResult, type RelatedOptions, type RelatedResult, type RuntimeConfig, type SessionResult, type StatusOptions, type StatusResult } from './types';
import type { AskOptions, AskResultV03 } from '../core/query/ask';

export class Pmem implements PmemInstance {
  readonly pmemPath: string;
  private db: Database.Database;
  private readonly scope: ScopeManager;
  private readonly policy: PolicyEngine;
  private events: EventStore;
  private readonly registeredCapabilities: CapabilitySet[];
  private closed = false;
  private semanticProvider: Promise<DisposableEmbeddingProvider> | null = null;

  static async open(opts: PmemOpenOptions): Promise<Pmem> {
    const config = loadRuntimeConfig(opts.root, opts.preset, opts.config);
    const pmemPath = toPmemPath(opts.root);
    const db = openOwnedDatabase(pmemPath);
    createSchema(db);
    return new Pmem(opts.root, pmemPath, config, db, opts.capabilities);
  }

  private constructor(
    readonly root: string,
    pmemPath: string,
    readonly config: RuntimeConfig,
    db: Database.Database,
    capabilities?: CapabilitySet[],
  ) {
    this.pmemPath = pmemPath;
    this.db = db;
    this.scope = new ScopeManager(root, config);
    this.policy = new PolicyEngine(config, capabilities ?? []);
    this.events = new EventStore(db, config.working.ttl);
    this.registeredCapabilities = capabilities ?? [];
  }

  async ask(query: string, opts?: AskOptions): Promise<AskResultV03> {
    this.assertOpen();
    try {
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
    const event = this.events.append({
      type: 'observe',
      scope,
      created_at: change.at,
      payload: {
        file: change.file,
        summary: change.summary,
        action: change.action,
        metadata: change.metadata,
      },
    });
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
    const durable = forgetMemory(this.db, request.id, {
      reason: request.reason,
      branch: scope.startsWith('branch:') ? scope.slice('branch:'.length) : null,
      sessionId: scope.startsWith('session:') ? scope.slice('session:'.length) : null,
    });
    const event = durable.success
      ? this.events.find(String(durable.eventId)) ?? this.events.append({
          id: String(durable.eventId),
          type: 'forget',
          scope,
          created_at: request.at,
          payload: {
            target_id: request.id,
            reason: request.reason,
            metadata: request.metadata,
            durable: true,
          },
        })
      : this.events.append({
          type: 'forget',
          scope,
          created_at: request.at,
          payload: {
            target_id: request.id,
            reason: request.reason,
            metadata: request.metadata,
            durable: false,
            error: durable.message,
          },
        });
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
    return captureCore(this.pmemPath, { ...opts, summary: captureSummary || undefined, cwd: this.root });
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    this.events.append({ type: 'session_end', scope, payload: { result } });
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
    this.db.close();
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
      throw new Error('Semantic manifest configuration is incompatible with v1.2.0. Run `pmem semantic setup`.');
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

export * from './types';
export { loadRuntimeConfig, PRESET_DEFAULTS } from './config';
export { ScopeManager } from './scope';
export { PolicyEngine } from './policy';
export { EventStore } from './event-store';
