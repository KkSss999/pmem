import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { randomUUID } from 'node:crypto';
import {
  L1ModelError,
  type L1Draft,
  type L1ExtractionModel,
  type L1IndexStatus,
  type L1Job,
  type L1JobPage,
  type L1JobState,
  type L1Memory,
} from '../../domain/memory/l1';
import { identifier, requireRead, requireWrite, validateAccess } from './index';
import type { MemoryRepository } from './ports';
import type { L1Repository } from './l1-ports';

export interface QueueL1Input {
  id: string;
  sourceIds: readonly string[];
  spaceId?: string;
  relatedSpaceIds?: readonly string[];
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

  enqueue(input: QueueL1Input, access: MemoryAccess): L1Job {
    if (!input || typeof input !== 'object')
      throw new MemoryError('INVALID_INPUT', 'An extraction request is required.');
    validateAccess(access);
    identifier(input.id, 'job ID');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (!Array.isArray(input.sourceIds) || !input.sourceIds.length)
      throw new MemoryError('INVALID_INPUT', 'At least one L0 source is required.');
    for (const id of input.sourceIds) identifier(id, 'source ID');
    if (input.relatedSpaceIds !== undefined && !Array.isArray(input.relatedSpaceIds))
      throw new MemoryError('INVALID_INPUT', 'relatedSpaceIds must be an array.');
    const sourceIds = [...new Set(input.sourceIds)].sort();
    const sources = this.repository.getSources(sourceIds, access.readableSpaceIds);
    const sourceSpaces = [...new Set(sources.map((source) => source.spaceId))];
    if (input.spaceId === undefined && sourceSpaces.length !== 1)
      throw new MemoryError(
        'INVALID_INPUT',
        'A target space is required for multiple source spaces.'
      );
    const spaceId = input.spaceId ?? sourceSpaces[0];
    identifier(spaceId, 'spaceId');
    requireRead(access, spaceId);
    requireWrite(access, spaceId);
    if (!this.l0.getSpace(spaceId))
      throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    const relatedSpaceIds = [...new Set(input.relatedSpaceIds ?? [])]
      .filter((id) => id !== spaceId)
      .sort();
    for (const id of relatedSpaceIds) {
      identifier(id, 'related space ID');
      requireRead(access, id);
    }
    const now = new Date().toISOString();
    return this.repository.createJob(
      {
        id: input.id,
        spaceId,
        sourceIds,
        relatedSpaceIds,
        state: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      access.readableSpaceIds
    );
  }

  getJob(id: string, access: MemoryAccess): L1Job | undefined {
    identifier(id, 'job ID');
    validateAccess(access);
    return this.repository.getJob(id, access.readableSpaceIds);
  }

  listJobs(
    options: { spaceId: string; state?: L1JobState; afterId?: string; limit?: number },
    access: MemoryAccess
  ): L1JobPage {
    if (!options || typeof options !== 'object')
      throw new MemoryError('INVALID_INPUT', 'List options are required.');
    identifier(options.spaceId, 'spaceId');
    requireRead(access, options.spaceId);
    if (options.afterId !== undefined) identifier(options.afterId, 'afterId');
    if (
      options.state !== undefined &&
      !['pending', 'running', 'succeeded', 'failed', 'unknown'].includes(options.state)
    )
      throw new MemoryError('INVALID_INPUT', 'Invalid job state.');
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new MemoryError('INVALID_INPUT', 'Invalid pagination limit.');
    return this.repository.listJobs(
      options.spaceId,
      options.state,
      options.afterId,
      limit,
      access.readableSpaceIds
    );
  }

  markInterrupted(id: string, access: MemoryAccess): L1Job {
    const job = this.getJob(id, access);
    if (!job) throw new MemoryError('JOB_NOT_FOUND', 'Extraction job not found.');
    requireWrite(access, job.spaceId);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (job.state !== 'running' || !job.claimToken)
      throw new MemoryError('JOB_NOT_PENDING', 'Extraction job is not running.');
    this.repository.failJob(id, job.claimToken, 'unknown', 'INTERRUPTED', new Date().toISOString());
    return this.repository.getJob(id, access.readableSpaceIds)!;
  }

  retry(id: string, access: MemoryAccess): L1Job {
    const job = this.getJob(id, access);
    if (!job) throw new MemoryError('JOB_NOT_FOUND', 'Extraction job not found.');
    requireWrite(access, job.spaceId);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (job.state !== 'failed' && job.state !== 'unknown')
      throw new MemoryError('JOB_NOT_PENDING', 'Extraction job is not retryable.');
    const result = this.repository.retryJob(id, job.state, new Date().toISOString());
    if (!result) throw new MemoryError('JOB_NOT_PENDING', 'Extraction job changed before retry.');
    return result;
  }

  async run(id: string, model: L1ExtractionModel, access: MemoryAccess): Promise<L1Job> {
    identifier(id, 'job ID');
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (!model || typeof model.extract !== 'function')
      throw new MemoryError('INVALID_INPUT', 'An extraction model is required.');
    const job = this.repository.getJob(id, access.readableSpaceIds);
    if (!job) throw new MemoryError('JOB_NOT_FOUND', 'Extraction job not found.');
    requireWrite(access, job.spaceId);
    const sources = this.repository.getSources(job.sourceIds, access.readableSpaceIds);
    const space = this.l0.getSpace(job.spaceId);
    if (!space) throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    const relatedIds = [
      ...new Set([...job.relatedSpaceIds, ...sources.map((source) => source.spaceId)]),
    ].filter((spaceId) => spaceId !== job.spaceId);
    const relatedSpaces = relatedIds.map((spaceId) => this.l0.getSpace(spaceId));
    if (relatedSpaces.some((related) => !related))
      throw new MemoryError('SPACE_NOT_FOUND', 'A related space does not exist.');
    const claimed = this.repository.claimJob(
      id,
      access.writableSpaceIds,
      randomUUID(),
      new Date().toISOString()
    );
    if (!claimed) throw new MemoryError('JOB_NOT_PENDING', 'Extraction job is not pending.');
    let drafts: L1Draft[];
    try {
      drafts = validateDrafts(
        await model.extract({
          messages: sources,
          space,
          relatedSpaces: relatedSpaces as NonNullable<typeof space>[],
        }),
        job.sourceIds,
        relatedIds
      );
    } catch (cause) {
      const state =
        cause instanceof L1ModelError
          ? cause.outcome
          : cause instanceof MemoryError && cause.code === 'MODEL_OUTPUT_INVALID'
            ? 'failed'
            : 'unknown';
      const failureCode =
        cause instanceof L1ModelError
          ? cause.code
          : cause instanceof MemoryError
            ? cause.code
            : 'MODEL_UNKNOWN';
      try {
        this.repository.failJob(
          id,
          claimed.claimToken!,
          state,
          failureCode,
          new Date().toISOString()
        );
      } catch (statusError) {
        throw new AggregateError(
          [cause, statusError],
          'Model failed and job status could not be persisted.'
        );
      }
      throw new MemoryError('MODEL_FAILED', `L1 extraction ${state}.`, { cause });
    }
    try {
      requireRead(access, job.spaceId);
      requireWrite(access, job.spaceId);
      for (const source of sources) requireRead(access, source.spaceId);
      for (const relatedId of relatedIds) requireRead(access, relatedId);
    } catch (cause) {
      try {
        this.repository.failJob(
          id,
          claimed.claimToken!,
          'failed',
          'ACCESS_CHANGED',
          new Date().toISOString()
        );
      } catch (statusError) {
        throw new AggregateError(
          [cause, statusError],
          'Access changed and job status could not be persisted.'
        );
      }
      throw cause;
    }
    this.repository.completeJob(claimed, sources, drafts, new Date().toISOString());
    return this.repository.getJob(id, access.readableSpaceIds)!;
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

  getJobMemories(jobId: string, access: MemoryAccess): L1Memory[] {
    identifier(jobId, 'job ID');
    validateAccess(access);
    return this.repository.listJobMemories(jobId, access.readableSpaceIds);
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
