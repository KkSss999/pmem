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

  prepare(items: readonly MemoryStreamItem[]): PreparedStreamItem | null {
    if (!items.length || items.some((item) => item.kind !== 'l1-extract'))
      throw new Error('L1StreamHandler only processes l1-extract items.');
    const messageIds = items.map((item) => item.subjectId);
    for (const item of items) {
      const actual = this.service.streamSourceHash(item.subjectId, this.access);
      if (actual !== item.sourceHash)
        throw Object.assign(new Error('L1 stream source changed.'), { code: 'L1_STALE_INPUT' });
    }
    const preparation = this.service.prepareStream(messageIds, this.access);
    // Nothing durable to extract from: finish without asking the model.
    if (preparation.messages.every((message) => !message.content.trim())) return null;
    return {
      envelope: {
        itemIds: items.map((item) => item.id),
        kind: 'l1-extract',
        space: { id: preparation.space.id, name: preparation.space.name },
        messages: preparation.messages.map((message) => ({
          id: message.id,
          spaceId: message.spaceId,
          role: message.role,
          content: message.content,
          occurredAt: message.occurredAt ?? null,
        })),
        allowedMessageIds: preparation.messages.map((message) => message.id),
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const memories = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(memories);
      },
    };
  }
}
