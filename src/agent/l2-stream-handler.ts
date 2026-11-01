import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { L2Service } from '../service/memory/l2';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

export class L2StreamHandler implements MemoryStreamHandler {
  constructor(
    private readonly service: L2Service,
    private readonly access: MemoryAccess,
    private readonly onCommitted?: (l2Ids: readonly string[]) => void
  ) {}

  async prepare(items: readonly MemoryStreamItem[]): Promise<PreparedStreamItem> {
    if (!items.length || items.some((item) => item.kind !== 'l2-synthesize'))
      throw new Error('L2StreamHandler only processes l2-synthesize items.');
    for (const item of items)
      if (this.service.streamSourceHash(item.subjectId, this.access) !== item.sourceHash)
        throw Object.assign(new Error('L2 stream source changed.'), { code: 'L2_STALE_INPUT' });
    const preparation = await this.service.prepareStream(
      items.map((item) => item.subjectId),
      this.access
    );
    return {
      envelope: {
        itemIds: items.map((item) => item.id),
        kind: 'l2-synthesize',
        l1: preparation.loaded.map((entry) => ({
          id: entry.memory.id,
          content: entry.memory.content,
          abstraction: entry.memory.abstraction,
          cues: entry.memory.cues,
          sourceIds: entry.memory.sourceIds,
          spaceId: entry.memory.spaceId,
          createdAt: entry.memory.createdAt,
        })),
        allowedL1Ids: preparation.loaded.map((entry) => entry.l1Id),
        candidates: preparation.candidatesForModel.map((candidate) => ({
          l2Id: candidate.memory.id,
          title: candidate.memory.title,
          summary: candidate.memory.summary,
          body: candidate.memory.body,
          l1Ids: candidate.memory.l1Ids,
          evidence: candidate.evidence.map((memory) => ({
            id: memory.id,
            content: memory.content,
            abstraction: memory.abstraction,
            cues: memory.cues,
          })),
        })),
        allowedCandidateIds: preparation.candidatesForModel.map((item) => item.memory.id),
        rules: [
          'Every supplied L1 must be covered by exactly one result or listed once in uncoveredL1Ids.',
          'Use action create or update; update needs the candidate l2Id and supersede true when the change replaces it.',
          'Never cite an L1 or candidate ID that is not supplied.',
        ],
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const result = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(result.l2Ids);
      },
    };
  }
}
