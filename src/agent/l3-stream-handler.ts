import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { L3Service } from '../service/memory/l3';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

/** L3 handler for the serial Memory Stream. No job or worker state. */
export class L3StreamHandler implements MemoryStreamHandler {
  constructor(
    private readonly service: L3Service,
    private readonly access: MemoryAccess
  ) {}

  prepare(item: MemoryStreamItem): PreparedStreamItem {
    if (item.kind !== 'l3-keywords')
      throw new Error(`L3StreamHandler cannot process ${item.kind}.`);
    const preparation = this.service.prepareStream(item.subjectId, item.sourceHash, this.access);
    return {
      envelope: {
        itemId: item.id,
        kind: item.kind,
        l2: {
          id: preparation.memory.id,
          title: preparation.memory.title,
          summary: preparation.memory.summary,
          body: preparation.memory.body,
          relatedSpaceIds: preparation.memory.relatedSpaceIds,
          l1Ids: preparation.memory.l1Ids,
        },
        existingKeywords: preparation.keywords.map((keyword) => ({
          term: keyword.term,
          aliases: keyword.aliases,
          kind: keyword.kind,
          sourceL2Ids: keyword.sourceL2Ids,
        })),
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        this.service.applyStream(preparation, payload, this.access);
      },
    };
  }
}
