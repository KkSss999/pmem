import {
  MemoryError,
  type AppendL0Input,
  type AppendL0Result,
  type MemoryAccess,
} from '../../domain/memory/types';
import type { L1ExtractionModel } from '../../domain/memory/l1';
import type { L1MaintenanceModel } from '../../domain/memory/l1-maintenance';
import type { L1MaintenanceService } from './l1-maintenance';
import { randomUUID } from 'node:crypto';
import { identifier, validateAccess, type MemoryService } from './index';
import type { L1Service } from './l1';
import type { L1ScheduleRepository } from './l1-scheduler-ports';

export class L1Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private readonly active = new Map<string, Promise<void>>();
  private stopped = false;
  private suspended = false;
  private lastError?: { jobId?: string; error: unknown };
  private stopping?: Promise<void>;
  private preferMaintenance = false;

  constructor(
    private readonly repository: L1ScheduleRepository,
    private readonly memory: MemoryService,
    private readonly l1: L1Service,
    private readonly model: L1ExtractionModel,
    private readonly access: MemoryAccess,
    readOnly: boolean,
    private readonly maintenance?: { service: L1MaintenanceService; model: L1MaintenanceModel }
  ) {
    validateAccess(access);
    if (!model || typeof model.extract !== 'function')
      throw new MemoryError('INVALID_INPUT', 'An extraction model is required.');
    if (readOnly) throw new MemoryError('READ_ONLY', 'L1 scheduling requires a writable database.');
  }

  start(): void {
    if (this.stopped) throw new Error('L1 scheduler is stopped.');
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }

  capture(input: AppendL0Input): AppendL0Result {
    if (!this.timer || this.stopped) throw new Error('L1 scheduler is not running.');
    if (!input || typeof input !== 'object')
      throw new MemoryError('INVALID_INPUT', 'A message is required.');
    identifier(input.source, 'source');
    identifier(input.sessionId, 'session ID');
    const result = this.memory.appendL0(input, this.access);
    queueMicrotask(() => this.tick());
    return result;
  }

  tick(): void {
    if (!this.timer || this.stopped || this.suspended) return;
    try {
      validateAccess(this.access);
      const allowed = this.access.readableSpaceIds.filter((id) =>
        this.access.writableSpaceIds.includes(id)
      );
      while (this.active.size < 2) {
        let jobId: string | undefined;
        let work: Promise<unknown> | undefined;
        let isMaintenance = false;
        if (this.preferMaintenance && this.maintenance) {
          work = this.maintenance.service.startBatch(this.maintenance.model, this.access);
          if (work) {
            jobId = `maintenance:${randomUUID()}`;
            isMaintenance = true;
          }
        }
        if (!work) {
          jobId = this.repository.next(allowed, [...this.active.keys()], new Date());
          if (jobId) work = this.l1.run(jobId, this.model, this.access);
        }
        if (!work && !this.preferMaintenance && this.maintenance) {
          work = this.maintenance.service.startBatch(this.maintenance.model, this.access);
          if (work) {
            jobId = `maintenance:${randomUUID()}`;
            isMaintenance = true;
          }
        }
        if (!work || !jobId) return;
        this.preferMaintenance = !isMaintenance;
        const activeId = jobId;
        const run = work
          .then(() => {})
          .catch((error: unknown) => {
            if (error instanceof MemoryError && error.code === 'JOB_NOT_PENDING') return;
            this.lastError = { jobId: activeId, error };
            if (!(error instanceof MemoryError && error.code === 'MODEL_FAILED'))
              this.suspended = true;
          })
          .finally(() => {
            this.active.delete(activeId);
            if (!this.stopped) queueMicrotask(() => this.tick());
          });
        this.active.set(activeId, run);
      }
    } catch (error) {
      this.lastError = { error };
      this.suspended = true;
    }
  }

  status(): {
    running: boolean;
    suspended: boolean;
    activeJobIds: readonly string[];
    maintenanceEnabled: boolean;
    lastError?: { jobId?: string; error: unknown };
  } {
    return {
      running: !!this.timer && !this.stopped,
      suspended: this.suspended,
      activeJobIds: [...this.active.keys()],
      maintenanceEnabled: !!this.maintenance,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  resume(): void {
    if (!this.timer || this.stopped) throw new Error('L1 scheduler is not running.');
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
