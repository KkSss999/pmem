import type { MemoryStreamRepository } from '../db/memory/stream-repository';
import type { MemoryStreamItem, MemoryStreamKind } from '../domain/memory/stream';
import type { AppendL0Input, AppendL0Result, MemoryAccess } from '../domain/memory/types';
import type { MemoryService } from '../service/memory';
import type { L1Service } from '../service/memory/l1';
import type { L1MaintenanceService } from '../service/memory/l1-maintenance';
import type { L2Service } from '../service/memory/l2';
import type { L3Service } from '../service/memory/l3';
import { L1StreamHandler } from './l1-stream-handler';
import { L1MaintenanceStreamHandler } from './l1-maintenance-stream-handler';
import { L2StreamHandler } from './l2-stream-handler';
import { L3StreamHandler } from './l3-stream-handler';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

/** Coverage items reuse the L2 item key with this suffix. */
const COVERAGE_SUFFIX = '#coverage';

/** How many same-kind items one model call may cover. */
const BATCH_LIMITS: Readonly<Record<MemoryStreamKind, number>> = {
  'l1-extract': 5,
  'l1-maintenance': 5,
  'l2-synthesize': 3,
  'l3-keywords': 6,
};

function baseHash(sourceHash: string): string {
  return sourceHash.endsWith(COVERAGE_SUFFIX)
    ? sourceHash.slice(0, -COVERAGE_SUFFIX.length)
    : sourceHash;
}

function suffixOf(sourceHash: string): string {
  return sourceHash.endsWith(COVERAGE_SUFFIX) ? COVERAGE_SUFFIX : '';
}

function isMissingSource(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  // The work item is already finished, merged away or otherwise not pending.
  return code === 'JOB_NOT_FOUND' || code === 'JOB_NOT_PENDING';
}

function isStale(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code.endsWith('_STALE_INPUT')
  );
}

export interface MemoryStreamPipelineOptions {
  queue: MemoryStreamRepository;
  workspaceId: string;
  scopeId: string;
  access: MemoryAccess;
  l1: L1Service;
  maintenance: L1MaintenanceService;
  l2: L2Service;
  l3: L3Service;
}

/** Single-session dispatcher and follow-up producer for all stream item kinds. */
export class MemoryStreamPipeline implements MemoryStreamHandler {
  private readonly l1: L1StreamHandler;
  private readonly maintenance: L1MaintenanceStreamHandler;
  private readonly l2: L2StreamHandler;
  private readonly l3: L3StreamHandler;

  constructor(private readonly options: MemoryStreamPipelineOptions) {
    const { queue, workspaceId, scopeId } = options;
    this.l3 = new L3StreamHandler(options.l3, options.access);
    this.l2 = new L2StreamHandler(options.l2, options.access, (l2Ids) => {
      for (const l2Id of l2Ids) {
        const sourceHash = options.l3.streamSourceHash(l2Id);
        if (sourceHash)
          queue.enqueue({
            workspaceId,
            scopeId,
            kind: 'l3-keywords',
            subjectId: l2Id,
            sourceHash,
          });
      }
    });
    this.maintenance = new L1MaintenanceStreamHandler(
      options.maintenance,
      options.access,
      (memoryIds) => {
        for (const memoryId of memoryIds) this.enqueueL2(memoryId);
      },
      (memoryIds) => {
        for (const memoryId of memoryIds) this.enqueueMaintenance(memoryId);
      }
    );
    // L2 waits for maintenance: an L1 memory is only synthesized once its
    // maintenance committed, so the L2 item is queued from the maintenance path.
    this.l1 = new L1StreamHandler(options.l1, options.access, (memories) => {
      for (const memory of memories) this.enqueueMaintenance(memory.id);
    });
  }

  /**
   * Prepare one model call for the claimed item plus same-kind pending siblings.
   * Items whose source changed or vanished are dropped from the batch, so a
   * batch never fails because one of its members went stale.
   */
  async prepare(items: readonly MemoryStreamItem[]): Promise<PreparedStreamItem | null> {
    const primary = items[0];
    if (!primary) return null;
    const batch = this.collect(primary);
    if (!batch) return null;
    const [first, ...rest] = batch;
    try {
      const prepared = await this.dispatch(batch);
      if (!prepared) {
        for (const item of rest) this.finish(item);
        return null;
      }
      return {
        envelope: prepared.envelope,
        apply: (payload) => {
          prepared.apply(payload);
          for (const item of rest) this.finish(item);
        },
      };
    } catch (error) {
      // A merged or removed source has nothing left to describe.
      if (isMissingSource(error)) {
        for (const item of rest) this.finish(item);
        return null;
      }
      if (!isStale(error)) throw error;
      return this.requeue(first);
    }
  }

  private dispatch(
    batch: readonly MemoryStreamItem[]
  ): PreparedStreamItem | null | Promise<PreparedStreamItem | null> {
    switch (batch[0].kind) {
      case 'l1-extract':
        return this.l1.prepare(batch);
      case 'l1-maintenance':
        return this.maintenance.prepare(batch);
      case 'l2-synthesize':
        return this.l2.prepare(batch);
      case 'l3-keywords':
        return this.l3.prepare(batch);
    }
  }

  /**
   * The claimed item plus pending siblings whose source hash still matches.
   * Returns null when the claimed item itself is stale.
   */
  private collect(primary: MemoryStreamItem): MemoryStreamItem[] | null {
    const hash = this.currentHash(primary);
    if (!hash) return null;
    if (hash !== baseHash(primary.sourceHash)) {
      this.requeue(primary);
      return null;
    }
    const limit = BATCH_LIMITS[primary.kind];
    if (limit <= 1) return [primary];
    const siblings = this.options.queue
      .pending(this.options.workspaceId, this.options.scopeId, primary.kind, limit * 2)
      .filter((item) => item.id !== primary.id);
    if (primary.kind === 'l2-synthesize' && !this.l2SourceReady(primary.subjectId)) return null;
    const batch = [primary];
    for (const sibling of siblings) {
      if (batch.length >= limit) break;
      if (this.currentHash(sibling) !== baseHash(sibling.sourceHash)) continue;
      if (sibling.kind === 'l2-synthesize' && !this.l2SourceReady(sibling.subjectId)) continue;
      batch.push(sibling);
    }
    return batch;
  }

  /** An L2 item may only run once its L1 memory finished maintenance. */
  private l2SourceReady(l1Id: string): boolean {
    try {
      const memory = this.options.l1.getMemory(l1Id, this.options.access);
      return !!memory && memory.maintenanceStatus === 'complete' && memory.sourcesComplete;
    } catch {
      return false;
    }
  }

  /** Current source hash for an item, or undefined when the source is gone. */
  private currentHash(item: MemoryStreamItem): string | undefined {
    const { access } = this.options;
    try {
      switch (item.kind) {
        case 'l1-extract':
          return this.options.l1.streamSourceHash(item.subjectId, access);
        case 'l2-synthesize':
          return this.options.l2.streamSourceHash(item.subjectId, access);
        case 'l3-keywords':
          return this.options.l3.streamSourceHash(item.subjectId);
        case 'l1-maintenance':
          return this.options.l1.streamContentHash(item.subjectId, access);
      }
    } catch {
      return undefined;
    }
  }

  /** Absorbed items were covered by the batch's model call. */
  private finish(item: MemoryStreamItem): void {
    this.options.queue.absorb(item.id);
  }

  /**
   * A source changed between enqueue and consume. The current state is the only
   * correct input, so queue the item again under its new hash instead of failing.
   */
  private requeue(item: MemoryStreamItem): null {
    const { queue, workspaceId, scopeId } = this.options;
    const sourceHash = this.currentHash(item);
    if (sourceHash)
      queue.enqueue({
        workspaceId,
        scopeId,
        kind: item.kind,
        subjectId: item.subjectId,
        sourceHash,
      });
    return null;
  }

  /**
   * Queue one synthesis per L1 memory that has no L2 yet. Batching can leave a
   * change uncovered, and a skipped change never gets another chance on its own.
   */
  enqueueL2Coverage(limit = 200): number {
    const { queue, workspaceId, scopeId, access } = this.options;
    const anchored = access.readableSpaceIds.slice(0, 1);
    const ids = this.options.l1.uncoveredMemoryIds([...anchored], access, limit);
    let queued = 0;
    for (const l1Id of ids) {
      let sourceHash: string;
      try {
        sourceHash = this.options.l2.streamSourceHash(l1Id, access);
      } catch {
        continue;
      }
      queue.enqueue({
        workspaceId,
        scopeId,
        kind: 'l2-synthesize',
        subjectId: l1Id,
        sourceHash: sourceHash + COVERAGE_SUFFIX,
      });
      queued++;
    }
    return queued;
  }

  /**
   * Maintenance identity is the reviewed content, so a memory whose candidate set
   * changed while a batch was running gets a fresh item instead of staying stuck.
   */
  private enqueueMaintenance(memoryId: string): void {
    let sourceHash: string;
    try {
      sourceHash = this.options.l1.streamContentHash(memoryId, this.options.access);
    } catch {
      return;
    }
    this.options.queue.enqueue({
      workspaceId: this.options.workspaceId,
      scopeId: this.options.scopeId,
      kind: 'l1-maintenance',
      subjectId: memoryId,
      sourceHash,
    });
  }

  private enqueueL2(l1Id: string): void {
    let sourceHash: string;
    try {
      sourceHash = this.options.l2.streamSourceHash(l1Id, this.options.access);
    } catch {
      // The memory was merged away by the same batch; nothing left to synthesize.
      return;
    }
    this.options.queue.enqueue({
      workspaceId: this.options.workspaceId,
      scopeId: this.options.scopeId,
      kind: 'l2-synthesize',
      subjectId: l1Id,
      sourceHash,
    });
  }
}

/** Append L0 and queue the corresponding L1 item. */
export class MemoryStreamIngest {
  constructor(
    private readonly memory: MemoryService,
    private readonly l1: L1Service,
    private readonly queue: MemoryStreamRepository,
    private readonly workspaceId: string,
    private readonly scopeId: string,
    private readonly access: MemoryAccess
  ) {}

  appendL0(input: AppendL0Input): AppendL0Result {
    const result = this.memory.appendL0(input, this.access);
    this.queue.enqueue({
      workspaceId: this.workspaceId,
      scopeId: this.scopeId,
      kind: 'l1-extract',
      subjectId: result.message.id,
      sourceHash: this.l1.streamSourceHash(result.message.id, this.access),
    });
    return result;
  }
}
