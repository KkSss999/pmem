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
import { toPmemPath, type CaptureOptions, type CaptureResult, type ContextQueryResult, type ForgetRequest, type Observation, type PmemInstance, type PmemOpenOptions, type Receipt, type RecallOptions, type RecallQueryResult, type RelatedOptions, type RelatedResult, type RuntimeConfig, type SessionResult, type StatusOptions, type StatusResult } from './types';
import type { AskOptions, AskResultV03 } from '../core/query/ask';

export class Pmem implements PmemInstance {
  readonly pmemPath: string;
  private db: Database.Database;
  private readonly scope: ScopeManager;
  private readonly policy: PolicyEngine;
  private events: EventStore;
  private closed = false;

  static async open(opts: PmemOpenOptions): Promise<Pmem> {
    const config = loadRuntimeConfig(opts.root, opts.preset, opts.config);
    const pmemPath = toPmemPath(opts.root);
    const db = openOwnedDatabase(pmemPath);
    createSchema(db);
    return new Pmem(opts.root, pmemPath, config, db);
  }

  private constructor(
    readonly root: string,
    pmemPath: string,
    readonly config: RuntimeConfig,
    db: Database.Database,
  ) {
    this.pmemPath = pmemPath;
    this.db = db;
    this.scope = new ScopeManager(root, config);
    this.policy = new PolicyEngine(config);
    this.events = new EventStore(db, config.working.ttl);
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
    const scope = this.scope.resolve(change.file ?? '', change);
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
    const requiresConfirmation = this.policy.requiresConfirmation({
      type: 'forget',
      scope,
      summary: request.reason,
      metadata: request.metadata,
    });
    const durable = forgetMemory(this.db, request.id, {
      reason: request.reason,
      branch: scope.startsWith('branch:') ? scope.slice('branch:'.length) : null,
      sessionId: null,
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
    const captureSummary = summary || opts.summary || '';
    const scope = this.scope.resolve('', { summary: captureSummary, metadata: opts as Record<string, unknown> });
    const result = captureCore(this.pmemPath, { ...opts, summary: captureSummary || undefined, cwd: this.root });
    if (result.success) {
      this.events.append({ type: 'commit', scope, payload: { summary: captureSummary, options: opts, tracePath: result.tracePath } });
    }
    return result;
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    this.events.append({ type: 'session_end', scope, payload: { result } });
    this.events.expire();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
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
