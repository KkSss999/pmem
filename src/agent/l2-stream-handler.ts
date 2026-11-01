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

  async prepare(item: MemoryStreamItem): Promise<PreparedStreamItem> {
    if (item.kind !== 'l2-synthesize')
      throw new Error(`L2StreamHandler cannot process ${item.kind}.`);
    if (this.service.streamSourceHash(item.subjectId, this.access) !== item.sourceHash)
      throw Object.assign(new Error('L2 stream source changed.'), { code: 'L2_STALE_INPUT' });
    const preparation = await this.service.prepareStream(item.subjectId, this.access);
    return {
      envelope: {
        itemId: item.id,
        kind: item.kind,
        l1: preparation.loaded.map((entry) => ({
          id: entry.memory.id,
          content: entry.memory.content,
          abstraction: entry.memory.abstraction,
          cues: entry.memory.cues,
          sourceIds: entry.memory.sourceIds,
          spaceId: entry.memory.spaceId,
          createdAt: entry.memory.createdAt,
        })),
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
        outputTool: 'memory_stream_submit',
      },
      apply: (payload) => {
        const result = this.service.applyStream(preparation, payload, this.access);
        this.onCommitted?.(result.l2Ids);
      },
    };
  }
}
