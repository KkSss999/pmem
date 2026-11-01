import type { L0Message } from '../../domain/memory/types';
import type { L1Draft, L1IndexStatus, L1Memory } from '../../domain/memory/l1';

export interface L1Repository {
  commitStream(input: readonly L0Message[], drafts: readonly L1Draft[], now: string): L1Memory[];
  getMemory(id: string, readableSpaceIds: readonly string[]): L1Memory | undefined;
  updateSpaceLinks(
    id: string,
    relatedSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    writableSpaceIds: readonly string[],
    now: string
  ): L1Memory;
  checkSearchIndex(): L1IndexStatus;
  rebuildSearchIndex(): void;
  searchMemories(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L1Memory[];
}
