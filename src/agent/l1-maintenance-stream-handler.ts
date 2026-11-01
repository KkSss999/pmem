import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { L1MaintenanceService } from '../service/memory/l1-maintenance';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

export class L1MaintenanceStreamHandler implements MemoryStreamHandler {
  constructor(
    private readonly service: L1MaintenanceService,
    private readonly access: MemoryAccess,
    private readonly onCommitted?: (memoryIds: readonly string[]) => void,
    private readonly onDeferred?: (memoryIds: readonly string[]) => void
  ) {}

  prepare(items: readonly MemoryStreamItem[]): PreparedStreamItem | null {
    if (!items.length || items.some((item) => item.kind !== 'l1-maintenance'))
      throw new Error('L1MaintenanceStreamHandler only processes l1-maintenance items.');
    const preparation = this.service.prepareStream(
      items.map((item) => item.subjectId),
      this.access
    );
    // Nothing to compare: keeping every case is a local decision, not a model call.
    if (preparation.modelCases.length === 0) {
      const ids = this.service.applyStream(preparation, { decisions: [] }, this.access);
      this.onCommitted?.(ids);
      return null;
    }
    return {
      envelope: {
        itemIds: items.map((item) => item.id),
        kind: 'l1-maintenance',
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
        rules: [
          'Submit exactly one decision per supplied case.',
          'For keep or uncertain send only memoryId and action.',
          'For merge send memoryId, action, targetId, content, abstraction and cues.',
        ],
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const ids = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(ids);
        const deferred = this.service.pendingIds(preparation.memoryIds, this.access);
        if (deferred.length) this.onDeferred?.(deferred);
      },
    };
  }
}
