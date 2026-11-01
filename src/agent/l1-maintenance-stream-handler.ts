import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { L1MaintenanceService } from '../service/memory/l1-maintenance';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

export class L1MaintenanceStreamHandler implements MemoryStreamHandler {
  constructor(
    private readonly service: L1MaintenanceService,
    private readonly access: MemoryAccess,
    private readonly onCommitted?: (memoryId: string) => void
  ) {}

  prepare(item: MemoryStreamItem): PreparedStreamItem {
    if (item.kind !== 'l1-maintenance')
      throw new Error(`L1MaintenanceStreamHandler cannot process ${item.kind}.`);
    const preparation = this.service.prepareStream(item.subjectId, this.access);
    return {
      envelope: {
        itemId: item.id,
        kind: item.kind,
        cases: preparation.modelCases.map((entry) => ({
          memory: {
            id: entry.memory.id,
            content: entry.memory.content,
            abstraction: entry.memory.abstraction,
            cues: entry.memory.cues,
          },
          candidates: entry.candidates.map((candidate) => ({
            id: candidate.id,
            content: candidate.content,
            abstraction: candidate.abstraction,
            cues: candidate.cues,
          })),
        })),
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const resultId = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(resultId ?? item.subjectId);
      },
    };
  }
}
