import type { L2IndexStatus, L2Memory } from '../../domain/memory/l2';

export interface L2Repository {
  listCandidates(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  listLinkedCandidates(
    ownerSpaceId: string,
    l1Ids: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  getMemory(id: string, readableSpaceIds: readonly string[]): L2Memory | undefined;
  listMemories(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
  applyCreate(input: {
    ownerSpaceId: string;
    title: string;
    summary: string;
    body: string;
    l1Ids: readonly string[];
    sourceIds: readonly string[];
    relatedSpaceIds: readonly string[];
    generationId: string;
    contentHash: string;
    now: string;
  }): L2Memory;
  applySupersede(oldL2Id: string, newL2Id: string, expectedHash: string, now: string): void;
  applyUpdate(input: {
    ownerSpaceId: string;
    l2Id: string;
    expectedHash: string;
    expectedL1Ids: readonly string[];
    title: string;
    summary: string;
    body: string;
    l1Ids: readonly string[];
    sourceIds: readonly string[];
    relatedSpaceIds: readonly string[];
    generationId: string;
    contentHash: string;
    now: string;
  }): L2Memory;
  checkSearchIndex(): L2IndexStatus;
  rebuildSearchIndex(): void;
  search(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[];
}
