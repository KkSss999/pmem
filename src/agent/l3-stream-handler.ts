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

  prepare(items: readonly MemoryStreamItem[]): PreparedStreamItem {
    if (!items.length || items.some((item) => item.kind !== 'l3-keywords'))
      throw new Error('L3StreamHandler only processes l3-keywords items.');
    const preparation = this.service.prepareStream(
      items.map((item) => ({ l2Id: item.subjectId, l2Hash: item.sourceHash })),
      this.access
    );
    return {
      envelope: {
        itemIds: items.map((item) => item.id),
        kind: 'l3-keywords',
        l2: preparation.entries.map((entry) => ({
          id: entry.memory.id,
          title: entry.memory.title,
          summary: entry.memory.summary,
          body: entry.memory.body,
          relatedSpaceIds: entry.memory.relatedSpaceIds,
          l1Ids: entry.memory.l1Ids,
        })),
        allowedL2Ids: preparation.entries.map((entry) => entry.l2Id),
        existingKeywords: preparation.keywords.map((keyword) => ({
          term: keyword.term,
          aliases: keyword.aliases,
          kind: keyword.kind,
          sourceL2Ids: keyword.sourceL2Ids,
        })),
        rules: [
          'Cite only supplied L2 IDs in l2Ids.',
          'term must be at most 64 characters; baseWeight is an integer from 1 to 5.',
          `Return at most ${MAX_KEYWORDS} keywords.`,
        ],
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        this.service.applyStream(preparation, payload, this.access);
      },
    };
  }
}

const MAX_KEYWORDS = 100;
