import Database from 'better-sqlite3';
import { askQuery } from '../core/query/ask';
import { recallQuery } from '../core/query/recall';
import { contextQuery } from '../core/query/context';
import { relatedQuery } from '../core/query/related';
import { statusQuery } from '../core/query/status';
import { captureCore } from '../core/capture';
import { closeDatabase, createSchema, openDatabase } from '../core/db';
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
    const db = openDatabase(pmemPath);
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
      return askQuery(this.pmemPath, query, { ...opts, now: opts?.now ?? Date.now() });
    } finally {
      this.ensureRuntimeDb();
    }
  }

  async recall(opts?: RecallOptions): Promise<RecallQueryResult> {
    this.assertOpen();
    try {
      return recallQuery(this.pmemPath, opts);
    } finally {
      this.ensureRuntimeDb();
    }
  }

  async context(task: string, budget?: number): Promise<ContextQueryResult> {
    this.assertOpen();
    try {
      return contextQuery(this.pmemPath, task, budget);
    } finally {
      this.ensureRuntimeDb();
    }
  }

  async related(id: string, opts?: RelatedOptions): Promise<RelatedResult> {
    this.assertOpen();
    try {
      return relatedQuery(this.pmemPath, id, opts);
    } finally {
      this.ensureRuntimeDb();
    }
  }

  async status(opts?: StatusOptions): Promise<StatusResult> {
    this.assertOpen();
    try {
      return statusQuery(this.pmemPath, opts);
    } finally {
      this.ensureRuntimeDb();
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
      requires_confirmation: this.policy.requiresConfirmation(proposal),
    };
  }

  async forget(request: ForgetRequest): Promise<Receipt> {
    this.assertOpen();
    const target = this.events.find(request.id);
    const scope = target?.scope ?? this.scope.resolve('', { metadata: request.metadata });
    const event = this.events.append({
      type: 'forget',
      scope,
      created_at: request.at,
      payload: {
        target_id: request.id,
        reason: request.reason,
        metadata: request.metadata,
      },
    });
    return {
      id: event.id,
      type: event.type,
      scope: event.scope,
      created_at: event.created_at,
      requires_confirmation: this.policy.requiresConfirmation({
        type: 'forget',
        scope,
        summary: request.reason,
        metadata: request.metadata,
      }),
    };
  }

  async capture(summary: string, opts: CaptureOptions = {}): Promise<CaptureResult> {
    this.assertOpen();
    const captureSummary = summary || opts.summary || '';
    const scope = this.scope.resolve('', { summary: captureSummary, metadata: opts as Record<string, unknown> });
    this.events.append({ type: 'commit', scope, payload: { summary: captureSummary, options: opts } });
    return captureCore(this.pmemPath, { ...opts, summary: captureSummary || undefined });
  }

  async endSession(result: SessionResult): Promise<void> {
    this.assertOpen();
    const scope = this.scope.resolve('', { summary: result.summary, metadata: result.metadata });
    this.events.append({ type: 'session_end', scope, payload: { result } });
    this.events.expire();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    closeDatabase(this.db);
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Pmem instance is already closed.');
  }

  private ensureRuntimeDb(): void {
    if (this.closed) return;
    try {
      this.db.prepare('SELECT 1').get();
    } catch {
      this.db = openDatabase(this.pmemPath);
      createSchema(this.db);
      this.events = new EventStore(this.db, this.config.working.ttl);
    }
  }
}

export * from './types';
export { loadRuntimeConfig, PRESET_DEFAULTS } from './config';
export { ScopeManager } from './scope';
export { PolicyEngine } from './policy';
export { EventStore } from './event-store';
