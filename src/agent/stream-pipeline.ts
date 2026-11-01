import type { MemoryStreamRepository } from '../db/memory/stream-repository';
import type { MemoryStreamItem } from '../domain/memory/stream';
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
      (memoryId) => this.enqueueL2(memoryId)
    );
    this.l1 = new L1StreamHandler(options.l1, options.access, (memories) => {
      for (const memory of memories) {
        queue.enqueue({
          workspaceId,
          scopeId,
          kind: 'l1-maintenance',
          subjectId: memory.id,
          sourceHash: 'v1',
        });
        this.enqueueL2(memory.id);
      }
    });
  }

  prepare(item: MemoryStreamItem): PreparedStreamItem | Promise<PreparedStreamItem> {
    switch (item.kind) {
      case 'l1-extract':
        return this.l1.prepare(item);
      case 'l1-maintenance':
        return this.maintenance.prepare(item);
      case 'l2-synthesize':
        return this.l2.prepare(item);
      case 'l3-keywords':
        return this.l3.prepare(item);
    }
  }

  private enqueueL2(l1Id: string): void {
    const sourceHash = this.options.l2.streamSourceHash(l1Id, this.options.access);
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
