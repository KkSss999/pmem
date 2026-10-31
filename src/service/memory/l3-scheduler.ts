import { randomUUID } from 'node:crypto';
import type { L3GenerationModel } from '../../domain/memory/l3';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { validateAccess } from './index';
import type { L3Service } from './l3';
import type { L3ScheduleRepository } from './l3-scheduler-ports';

export interface L3SchedulerOptions {
  batchSize?: number;
  idleMs?: number;
  maxWaitMs?: number;
}

export class L3Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;
  private suspended = false;
  private lastError?: unknown;
  private stopping?: Promise<void>;
  private readonly batchSize: number;
  private readonly idleMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly repository: L3ScheduleRepository,
    private readonly l3: L3Service,
    private readonly model: L3GenerationModel,
    private readonly access: MemoryAccess,
    readOnly: boolean,
    options: L3SchedulerOptions = {}
  ) {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Memory management is not allowed.');
    if (!model || typeof model.generateKeywords !== 'function')
      throw new MemoryError('INVALID_INPUT', 'An L3 generation model is required.');
    if (readOnly) throw new MemoryError('READ_ONLY', 'L3 scheduling requires a writable database.');
    this.batchSize = options.batchSize ?? 10;
    this.idleMs = options.idleMs ?? 30_000;
    this.maxWaitMs = options.maxWaitMs ?? 24 * 60 * 60 * 1000;
    for (const value of [this.batchSize, this.idleMs, this.maxWaitMs])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new MemoryError('INVALID_INPUT', 'Invalid L3 scheduler options.');
  }

  start(): void {
    if (this.stopped) throw new Error('L3 scheduler is stopped.');
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }

  tick(): void {
    if (!this.timer || this.stopped || this.suspended || this.active) return;
    try {
      validateAccess(this.access);
      this.l3.expire(this.access);
      if (
        !this.repository.next(new Date(), {
          batchSize: this.batchSize,
          idleMs: this.idleMs,
          maxWaitMs: this.maxWaitMs,
        })
      )
        return;
      const id = randomUUID();
      this.l3.enqueue({ id }, this.access);
      this.active = this.l3
        .run(id, this.model, this.access)
        .then(() => {})
        .catch((error: unknown) => {
          if (error instanceof MemoryError && error.code === 'JOB_NOT_PENDING') return;
          this.lastError = error;
          if (!(error instanceof MemoryError && error.code === 'L3_MODEL_FAILED'))
            this.suspended = true;
        })
        .finally(() => {
          this.active = undefined;
          if (!this.stopped) queueMicrotask(() => this.tick());
        });
    } catch (error) {
      this.lastError = error;
      this.suspended = true;
    }
  }

  status(): {
    running: boolean;
    suspended: boolean;
    active: boolean;
    lastError?: unknown;
  } {
    return {
      running: !!this.timer && !this.stopped,
      suspended: this.suspended,
      active: !!this.active,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  resume(): void {
    if (!this.timer || this.stopped) throw new Error('L3 scheduler is not running.');
    this.suspended = false;
    this.lastError = undefined;
    this.tick();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopping = (this.active ?? Promise.resolve()).then(() => {});
    return this.stopping;
  }
}
