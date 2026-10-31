import { randomUUID } from 'node:crypto';
import type { L2GenerationModel } from '../../domain/memory/l2';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { validateAccess } from './index';
import type { L2Service } from './l2';
import type { L2ScheduleRepository } from './l2-scheduler-ports';

export interface L2SchedulerOptions {
  batchSize?: number;
  idleMs?: number;
  maxWaitMs?: number;
  maxConcurrent?: number;
}

export class L2Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private readonly active = new Map<string, Promise<void>>();
  private stopped = false;
  private suspended = false;
  private lastError?: { ownerSpaceId?: string; error: unknown };
  private stopping?: Promise<void>;
  private readonly batchSize: number;
  private readonly idleMs: number;
  private readonly maxWaitMs: number;
  private readonly maxConcurrent: number;

  constructor(
    private readonly repository: L2ScheduleRepository,
    private readonly l2: L2Service,
    private readonly model: L2GenerationModel,
    private readonly access: MemoryAccess,
    readOnly: boolean,
    options: L2SchedulerOptions = {}
  ) {
    validateAccess(access);
    if (!model || typeof model.generate !== 'function')
      throw new MemoryError('INVALID_INPUT', 'An L2 generation model is required.');
    if (readOnly) throw new MemoryError('READ_ONLY', 'L2 scheduling requires a writable database.');
    this.batchSize = options.batchSize ?? 10;
    this.idleMs = options.idleMs ?? 30_000;
    this.maxWaitMs = options.maxWaitMs ?? 300_000;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    for (const value of [this.batchSize, this.idleMs, this.maxWaitMs, this.maxConcurrent])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new MemoryError('INVALID_INPUT', 'Invalid L2 scheduler options.');
  }

  start(): void {
    if (this.stopped) throw new Error('L2 scheduler is stopped.');
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }

  tick(): void {
    if (!this.timer || this.stopped || this.suspended) return;
    try {
      validateAccess(this.access);
      const allowed = this.access.readableSpaceIds.filter((id) =>
        this.access.writableSpaceIds.includes(id)
      );
      while (this.active.size < this.maxConcurrent) {
        const ownerSpaceId = this.repository.next(allowed, [...this.active.keys()], new Date(), {
          batchSize: this.batchSize,
          idleMs: this.idleMs,
          maxWaitMs: this.maxWaitMs,
        });
        if (!ownerSpaceId) return;
        const jobId = randomUUID();
        this.l2.enqueue({ id: jobId, ownerSpaceId }, this.access);
        const work = this.l2
          .run(jobId, this.model, this.access)
          .then(() => {})
          .catch((error: unknown) => {
            if (error instanceof MemoryError && error.code === 'JOB_NOT_PENDING') return;
            this.lastError = { ownerSpaceId, error };
            if (!(error instanceof MemoryError && error.code === 'L2_MODEL_FAILED'))
              this.suspended = true;
          })
          .finally(() => {
            this.active.delete(ownerSpaceId);
            if (!this.stopped) queueMicrotask(() => this.tick());
          });
        this.active.set(ownerSpaceId, work);
      }
    } catch (error) {
      this.lastError = { error };
      this.suspended = true;
    }
  }

  status(): {
    running: boolean;
    suspended: boolean;
    activeOwnerSpaceIds: readonly string[];
    lastError?: { ownerSpaceId?: string; error: unknown };
  } {
    return {
      running: !!this.timer && !this.stopped,
      suspended: this.suspended,
      activeOwnerSpaceIds: [...this.active.keys()],
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  resume(): void {
    if (!this.timer || this.stopped) throw new Error('L2 scheduler is not running.');
    this.suspended = false;
    this.lastError = undefined;
    this.tick();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopping = Promise.all(this.active.values()).then(() => {});
    return this.stopping;
  }
}
