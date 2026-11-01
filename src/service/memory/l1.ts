import { MemoryError, type L0Message, type MemoryAccess } from '../../domain/memory/types';
import { createHash } from 'node:crypto';
import { type L1Draft, type L1IndexStatus, type L1Memory } from '../../domain/memory/l1';
import { identifier, requireRead, requireWrite, validateAccess } from './index';
import type { MemoryRepository } from './ports';
import type { L1Repository } from './l1-ports';

export interface L1StreamPreparation {
  message: L0Message;
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
  return (value as { memories: unknown[] }).memories.map((item) => {
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
      !Array.isArray(draft.sourceIds) ||
      !draft.sourceIds.length
    ) {
      throw new MemoryError(
        'MODEL_OUTPUT_INVALID',
        'A memory needs content, an abstraction, cues and source IDs.'
      );
    }
    if (
      draft.cues.some((cue) => typeof cue !== 'string' || !cue.trim()) ||
      draft.sourceIds.some((id) => typeof id !== 'string' || !allowedIds.includes(id)) ||
      draft.relatedSpaceIds.some((id) => typeof id !== 'string' || !allowedSpaces.includes(id))
    ) {
      throw new MemoryError(
        'MODEL_OUTPUT_INVALID',
        'The memory contains invalid cues or source IDs.'
      );
    }
    return {
      content: draft.content.trim(),
      abstraction: draft.abstraction.trim(),
      cues: [...new Set((draft.cues as string[]).map((cue) => cue.trim()))],
      sourceIds: [...new Set(draft.sourceIds as string[])],
      relatedSpaceIds: [...new Set(draft.relatedSpaceIds as string[])],
    };
  });
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

  prepareStream(messageId: string, access: MemoryAccess): L1StreamPreparation {
    identifier(messageId, 'message ID');
    validateAccess(access);
    const message = this.l0.getMessage(messageId, access.readableSpaceIds);
    if (!message) throw new MemoryError('JOB_NOT_FOUND', 'L0 message not found.');
    requireRead(access, message.spaceId);
    requireWrite(access, message.spaceId);
    const space = this.l0.getSpace(message.spaceId);
    if (!space) throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    return { message, space, now: new Date().toISOString() };
  }

  applyStream(prep: L1StreamPreparation, raw: unknown, access: MemoryAccess): L1Memory[] {
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    requireRead(access, prep.message.spaceId);
    requireWrite(access, prep.message.spaceId);
    const drafts = validateDrafts(raw, [prep.message.id], []);
    return this.repository.commitStream([prep.message], drafts, new Date().toISOString());
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
