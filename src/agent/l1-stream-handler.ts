import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { L1Service } from '../service/memory/l1';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

export class L1StreamHandler implements MemoryStreamHandler {
  constructor(
    private readonly service: L1Service,
    private readonly access: MemoryAccess,
    private readonly onCommitted?: (memories: import('../domain/memory/l1').L1Memory[]) => void
  ) {}

  prepare(item: MemoryStreamItem): PreparedStreamItem {
    if (item.kind !== 'l1-extract') throw new Error(`L1StreamHandler cannot process ${item.kind}.`);
    const actual = this.service.streamSourceHash(item.subjectId, this.access);
    if (actual !== item.sourceHash)
      throw Object.assign(new Error('L1 stream source changed.'), { code: 'L1_STALE_INPUT' });
    const preparation = this.service.prepareStream(item.subjectId, this.access);
    return {
      envelope: {
        itemId: item.id,
        kind: item.kind,
        space: { id: preparation.space.id, name: preparation.space.name },
        message: {
          id: preparation.message.id,
          spaceId: preparation.message.spaceId,
          role: preparation.message.role,
          content: preparation.message.content,
          occurredAt: preparation.message.occurredAt ?? null,
        },
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const memories = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(memories);
      },
    };
  }
}
