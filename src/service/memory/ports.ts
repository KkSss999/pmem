import type { AppendL0Input, AppendL0Result, L0Page, MemorySpace } from '../../domain/memory/types';

export interface MemoryRepository {
  getSpace(id: string): MemorySpace | undefined;
  listSpaces(ids: readonly string[]): MemorySpace[];
  createSpace(space: MemorySpace): void;
  appendMessage(input: AppendL0Input, id: string, recordedAt: string): AppendL0Result;
  getMessage(
    id: string,
    readableSpaceIds: readonly string[]
  ): import('../../domain/memory/types').L0Message | undefined;
  listMessages(
    spaceId: string,
    sessionId: string | undefined,
    afterSequence: number,
    limit: number
  ): L0Page;
}
