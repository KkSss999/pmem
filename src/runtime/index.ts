import Database from 'better-sqlite3';
import { askQuery } from '../core/query/ask';
import { recallQuery } from '../core/query/recall';
import { contextQuery } from '../core/query/context';
import { relatedQuery } from '../core/query/related';
import { statusQuery } from '../core/query/status';
import { captureCore } from '../core/capture';
import { createSchema, forgetMemory, openOwnedDatabase } from '../core/db';
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
      return askQuery(this.pmemPath, query, { ...opts, now: opts?.now ?? Date.now(), db: this.db });
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
      return contextQuery(this.pmemPath, task, budget, this.db, this.root);
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
    const quotaCheck = this.policy.checkQuota(principal, 'observe');
    if (!quotaCheck.allowed) throw new Error(`QuotaExceededError: observation quota exceeded for ${principal}`);
    const scope = this.scope.resolve(change.file ?? '', change);
    this.requireCapability('memory.observe', scope);
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
    const target = this.events.find(request.id);
    const scope = target?.scope ?? this.scope.resolve('', { metadata: request.metadata });
    this.requireCapability('memory.forget', scope);
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
    const quotaCheck = this.policy.checkQuota(principal, 'capture');
    if (!quotaCheck.allowed) throw new Error(`QuotaExceededError: capture quota exceeded for ${principal}`);
    const captureSummary = summary || opts.summary || '';
    const scope = this.scope.resolve((opts as Record<string, unknown>).file as string ?? '', { summary: captureSummary });
    this.requireCapability('memory.commit', scope);
    return captureCore(this.pmemPath, { ...opts, summary: captureSummary || undefined, cwd: this.root });
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    this.events.append({ type: 'session_end', scope, payload: { result } });
    this.events.expire();
  }

  async mergeBranchMemory(sourceBranch: string, targetBranch: string = 'main'): Promise<number> {
    this.assertOpen();
    return this.events.mergeBranch(sourceBranch, targetBranch);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private requireCapability(capability: MemoryCapability, scope: string): void {
    if (this.registeredCapabilities.length === 0) return;
    for (const set of this.registeredCapabilities) {
      if (this.policy.checkCapability(set.principal, capability, scope)) return;
    }
    throw new Error(
      `Operation requires capability '${capability}' on scope '${scope}', but no principal has it.`
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Pmem instance is already closed.');
  }

}

export * from './types';
export { loadRuntimeConfig, PRESET_DEFAULTS } from './config';
export { ScopeManager } from './scope';
export { PolicyEngine } from './policy';
export { EventStore } from './event-store';
