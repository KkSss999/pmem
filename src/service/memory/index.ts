import { randomUUID } from 'node:crypto';
import {
  MemoryError,
  PERSONAL_SPACE_ID,
  type AppendL0Input,
  type AppendL0Result,
  type L0Message,
  type L0Page,
  type MemoryAccess,
  type MemorySpace,
} from '../../domain/memory/types';
import type { MemoryRepository } from './ports';

export function identifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new MemoryError(
      'INVALID_INPUT',
      `${field} must be a non-empty string without surrounding whitespace.`
    );
  }
}

export function validateAccess(access: MemoryAccess): void {
  if (
    !access ||
    !Array.isArray(access.readableSpaceIds) ||
    !Array.isArray(access.writableSpaceIds) ||
    typeof access.canManageSpaces !== 'boolean'
  ) {
    throw new MemoryError('INVALID_INPUT', 'A trusted memory access context is required.');
  }
  for (const id of [...access.readableSpaceIds, ...access.writableSpaceIds])
    identifier(id, 'space ID');
}

export function requireRead(access: MemoryAccess, id: string): void {
  validateAccess(access);
  if (!access.readableSpaceIds.includes(id))
    throw new MemoryError('ACCESS_DENIED', 'Space is not readable.');
}

export function requireWrite(access: MemoryAccess, id: string): void {
  validateAccess(access);
  if (!access.writableSpaceIds.includes(id))
    throw new MemoryError('ACCESS_DENIED', 'Space is not writable.');
}

function validateMessage(input: AppendL0Input): void {
  if (!input || typeof input !== 'object')
    throw new MemoryError('INVALID_INPUT', 'A message is required.');
  identifier(input.spaceId, 'spaceId');
  if (input.role !== 'user' && input.role !== 'assistant')
    throw new MemoryError('INVALID_INPUT', 'role must be user or assistant.');
  if (typeof input.content !== 'string')
    throw new MemoryError('INVALID_INPUT', 'content must be a string.');
  for (const field of ['source', 'sourceEventId', 'sessionId'] as const) {
    if (input[field] !== undefined) identifier(input[field], field);
  }
  if (input.sourceEventId !== undefined && input.source === undefined) {
    throw new MemoryError('INVALID_INPUT', 'source is required when sourceEventId is provided.');
  }
  if (input.occurredAt !== undefined) {
    const time = input.occurredAt;
    if (
      typeof time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time) ||
      !Number.isFinite(Date.parse(time))
    ) {
      throw new MemoryError('INVALID_INPUT', 'occurredAt must be an ISO timestamp with timezone.');
    }
    const date = time.slice(0, 10);
    if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new MemoryError('INVALID_INPUT', 'occurredAt must have a valid calendar date.');
    }
  }
}

export class MemoryService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly readOnly: boolean
  ) {}

  createSpace(name: string, access: MemoryAccess): MemorySpace {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Space management is not allowed.');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (typeof name !== 'string' || !name.trim())
      throw new MemoryError('INVALID_INPUT', 'A space name is required.');
    const space: MemorySpace = {
      id: randomUUID(),
      name: name.trim(),
      kind: 'custom',
      createdAt: new Date().toISOString(),
    };
    this.repository.createSpace(space);
    return space;
  }

  listSpaces(access: MemoryAccess): MemorySpace[] {
    validateAccess(access);
    return this.repository.listSpaces(access.readableSpaceIds);
  }

  anchorSpaces(spaceIds: readonly string[], access: MemoryAccess): readonly string[] {
    validateAccess(access);
    if (!Array.isArray(spaceIds))
      throw new MemoryError('INVALID_INPUT', 'spaceIds must be an array.');
    const ids = [...new Set([PERSONAL_SPACE_ID, ...spaceIds])];
    for (const id of ids) {
      identifier(id, 'space ID');
      requireRead(access, id);
      if (!this.repository.getSpace(id))
        throw new MemoryError('SPACE_NOT_FOUND', 'An anchored space does not exist.');
    }
    return ids;
  }

  appendL0(input: AppendL0Input, access: MemoryAccess): AppendL0Result {
    validateMessage(input);
    requireWrite(access, input.spaceId);
    // The result includes the persisted message, including on an idempotent replay.
    requireRead(access, input.spaceId);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (!this.repository.getSpace(input.spaceId))
      throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    return this.repository.appendMessage(input, randomUUID(), new Date().toISOString());
  }

  getL0(id: string, access: MemoryAccess): L0Message | undefined {
    identifier(id, 'message ID');
    validateAccess(access);
    return this.repository.getMessage(id, access.readableSpaceIds);
  }

  listL0(
    options: { spaceId: string; sessionId?: string; afterSequence?: number; limit?: number },
    access: MemoryAccess
  ): L0Page {
    if (!options || typeof options !== 'object')
      throw new MemoryError('INVALID_INPUT', 'List options are required.');
    identifier(options.spaceId, 'spaceId');
    requireRead(access, options.spaceId);
    if (options.sessionId !== undefined) identifier(options.sessionId, 'sessionId');
    const after = options.afterSequence ?? 0;
    const limit = options.limit ?? 100;
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new MemoryError('INVALID_INPUT', 'Invalid pagination options.');
    }
    return this.repository.listMessages(options.spaceId, options.sessionId, after, limit);
  }
}
