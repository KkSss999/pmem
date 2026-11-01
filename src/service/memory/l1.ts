import { MemoryError, type L0Message, type MemoryAccess } from '../../domain/memory/types';
import { createHash } from 'node:crypto';
import { type L1Draft, type L1IndexStatus, type L1Memory } from '../../domain/memory/l1';
import { identifier, requireRead, requireWrite, validateAccess } from './index';
import type { MemoryRepository } from './ports';
import type { L1Repository } from './l1-ports';

export interface L1StreamPreparation {
  messages: L0Message[];
  space: import('../../domain/memory/types').MemorySpace;
  now: string;
}

function validateDrafts(
  value: unknown,
  allowedIds: readonly string[],
  allowedSpaces: readonly string[]
): L1Draft[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { memories?: unknown }).memories)
  ) {
    throw new MemoryError('MODEL_OUTPUT_INVALID', 'Model output must contain a memories array.');
  }
  const drafts: L1Draft[] = [];
  for (const item of (value as { memories: unknown[] }).memories) {
    if (!item || typeof item !== 'object')
      throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid memory output.');
    const draft = item as Record<string, unknown>;
    if (
      typeof draft.content !== 'string' ||
      !draft.content.trim() ||
      typeof draft.abstraction !== 'string' ||
      !draft.abstraction.trim() ||
      !Array.isArray(draft.cues) ||
      !Array.isArray(draft.relatedSpaceIds) ||
      !Array.isArray(draft.sourceIds)
    ) {
      throw new MemoryError(
        'MODEL_OUTPUT_INVALID',
        'A memory needs content, an abstraction, cues and source IDs.'
      );
    }
    // Unknown IDs are dropped instead of discarding the memory: one invented
    // citation must not cost the whole extraction.
    const sourceIds = [
      ...new Set(
        draft.sourceIds.filter(
          (id): id is string => typeof id === 'string' && allowedIds.includes(id)
        )
      ),
    ];
    if (!sourceIds.length) continue;
    const relatedSpaceIds = [
      ...new Set(
        draft.relatedSpaceIds.filter(
          (id): id is string => typeof id === 'string' && allowedSpaces.includes(id)
        )
      ),
    ];
    drafts.push({
      content: draft.content.trim(),
      abstraction: draft.abstraction.trim(),
      cues: [
        ...new Set(
          draft.cues
            .filter((cue): cue is string => typeof cue === 'string' && !!cue.trim())
            .map((cue) => cue.trim())
        ),
      ],
      sourceIds,
      relatedSpaceIds,
    });
  }
  return drafts;
}

export class L1Service {
  constructor(
    private readonly repository: L1Repository,
    private readonly l0: MemoryRepository,
    private readonly readOnly: boolean
  ) {}

  streamSourceHash(messageId: string, access: MemoryAccess): string {
    identifier(messageId, 'message ID');
    validateAccess(access);
    const message = this.l0.getMessage(messageId, access.readableSpaceIds);
    if (!message) throw new MemoryError('JOB_NOT_FOUND', 'L0 message not found.');
    return createHash('sha256')
      .update(
        JSON.stringify({
          id: message.id,
          spaceId: message.spaceId,
          role: message.role,
          content: message.content,
          occurredAt: message.occurredAt ?? null,
          recordedAt: message.recordedAt,
        })
      )
      .digest('hex');
  }

  /**
   * Prepare one extraction for a batch of L0 messages. All messages must belong
   * to the same space, so the batch shares one target space and one prompt.
   */
  /** Stable identity of an L1 memory's reviewed content, used as the item hash. */
  streamContentHash(memoryId: string, access: MemoryAccess): string {
    identifier(memoryId, 'memory ID');
    validateAccess(access);
    const memory = this.repository.getMemory(memoryId, access.readableSpaceIds);
    if (!memory) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
    return createHash('sha256')
      .update(
        JSON.stringify({
          content: memory.content,
          abstraction: memory.abstraction,
          cues: [...memory.cues].sort(),
          spaceId: memory.spaceId,
          relatedSpaceIds: [...memory.relatedSpaceIds].sort(),
          sourceIds: [...memory.sourceIds].sort(),
        })
      )
      .digest('hex');
  }

  prepareStream(messageIds: string | readonly string[], access: MemoryAccess): L1StreamPreparation {
    if (typeof messageIds === 'string') messageIds = [messageIds];
    if (!Array.isArray(messageIds) || !messageIds.length)
      throw new MemoryError('INVALID_INPUT', 'At least one L0 message is required.');
    validateAccess(access);
    const messages = [...new Set(messageIds)].map((messageId) => {
      identifier(messageId, 'message ID');
      const message = this.l0.getMessage(messageId, access.readableSpaceIds);
      if (!message) throw new MemoryError('JOB_NOT_FOUND', 'L0 message not found.');
      return message;
    });
    const spaceId = messages[0].spaceId;
    if (messages.some((message) => message.spaceId !== spaceId))
      throw new MemoryError('INVALID_INPUT', 'A batch must share one space.');
    requireRead(access, spaceId);
    requireWrite(access, spaceId);
    const space = this.l0.getSpace(spaceId);
    if (!space) throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    return { messages, space, now: new Date().toISOString() };
  }

  applyStream(prep: L1StreamPreparation, raw: unknown, access: MemoryAccess): L1Memory[] {
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    requireRead(access, prep.space.id);
    requireWrite(access, prep.space.id);
    const drafts = validateDrafts(
      raw,
      prep.messages.map((message) => message.id),
      []
    );
    return this.repository.commitStream(prep.messages, drafts, new Date().toISOString());
  }

  getMemory(id: string, access: MemoryAccess): L1Memory | undefined {
    identifier(id, 'memory ID');
    validateAccess(access);
    return this.repository.getMemory(id, access.readableSpaceIds);
  }

  updateSpaceLinks(id: string, relatedSpaceIds: readonly string[], access: MemoryAccess): L1Memory {
    identifier(id, 'memory ID');
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (!Array.isArray(relatedSpaceIds))
      throw new MemoryError('INVALID_INPUT', 'relatedSpaceIds must be an array.');
    const memory = this.repository.getMemory(id, access.readableSpaceIds);
    if (!memory) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
    requireRead(access, memory.spaceId);
    requireWrite(access, memory.spaceId);
    const next = [...new Set(relatedSpaceIds)].filter((spaceId) => spaceId !== memory.spaceId);
    for (const spaceId of next) {
      identifier(spaceId, 'related space ID');
      requireRead(access, spaceId);
      if (!this.l0.getSpace(spaceId))
        throw new MemoryError('SPACE_NOT_FOUND', 'A related space does not exist.');
    }
    return this.repository.updateSpaceLinks(
      id,
      next,
      access.readableSpaceIds,
      access.writableSpaceIds,
      new Date().toISOString()
    );
  }

  /** L1 memories whose maintenance finished but no L2 memory cites yet. */
  uncoveredMemoryIds(
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    limit = 200
  ): string[] {
    validateAccess(access);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new MemoryError('INVALID_INPUT', 'Invalid coverage limit.');
    const anchored = [...new Set(anchoredSpaceIds)];
    for (const spaceId of anchored) identifier(spaceId, 'space ID');
    return this.repository.uncoveredMemoryIds(anchored, access.readableSpaceIds, limit);
  }

  searchIndexStatus(access: MemoryAccess): L1IndexStatus {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Memory management is not allowed.');
    return this.repository.checkSearchIndex();
  }

  rebuildSearchIndex(access: MemoryAccess): void {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Memory management is not allowed.');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    this.repository.rebuildSearchIndex();
  }

  recall(
    options: { query: string; anchoredSpaceIds: readonly string[]; limit?: number },
    access: MemoryAccess
  ): L1Memory[] {
    validateAccess(access);
    if (
      !options ||
      typeof options.query !== 'string' ||
      !options.query.trim() ||
      options.query.length > 256 ||
      !Array.isArray(options.anchoredSpaceIds) ||
      !options.anchoredSpaceIds.length
    )
      throw new MemoryError('INVALID_INPUT', 'A query and anchored spaces are required.');
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new MemoryError('INVALID_INPUT', 'Invalid recall limit.');
    const anchored = [...new Set(options.anchoredSpaceIds)];
    for (const id of anchored) {
      identifier(id, 'space ID');
      requireRead(access, id);
      if (!this.l0.getSpace(id)) throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    }
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const terms = [
      ...new Set(
        [...segmenter.segment(options.query)]
          .filter((item) => item.isWordLike)
          .map((item) => item.segment.toLowerCase())
      ),
    ].slice(0, 32);
    return this.repository.searchMemories(terms, anchored, access.readableSpaceIds, limit);
  }
}
