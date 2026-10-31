export const PERSONAL_SPACE_ID = 'personal';

export type ConversationRole = 'user' | 'assistant';
export type SpaceKind = 'personal' | 'custom';

export interface MemorySpace {
  id: string;
  name: string;
  kind: SpaceKind;
  createdAt: string;
}

/** Supplied by a trusted caller. Identifiers are not themselves proof of authorization. */
export interface MemoryAccess {
  readableSpaceIds: readonly string[];
  writableSpaceIds: readonly string[];
  canManageSpaces: boolean;
}

export interface L0Message {
  id: string;
  sequence: number;
  spaceId: string;
  role: ConversationRole;
  content: string;
  source?: string;
  sourceEventId?: string;
  sessionId?: string;
  occurredAt?: string;
  recordedAt: string;
}

export interface AppendL0Input {
  spaceId: string;
  role: ConversationRole;
  content: string;
  source?: string;
  sourceEventId?: string;
  sessionId?: string;
  occurredAt?: string;
}

export interface AppendL0Result {
  message: L0Message;
  created: boolean;
}

export interface L0Page {
  messages: readonly L0Message[];
  nextSequence?: number;
}

export type MemoryErrorCode =
  | 'INVALID_INPUT'
  | 'ACCESS_DENIED'
  | 'SPACE_NOT_FOUND'
  | 'SOURCE_CONFLICT'
  | 'JOB_NOT_FOUND'
  | 'JOB_NOT_PENDING'
  | 'MODEL_FAILED'
  | 'MODEL_OUTPUT_INVALID'
  | 'INDEX_MISSING'
  | 'INDEX_STALE'
  | 'INDEX_CORRUPT'
  | 'INDEX_UNAVAILABLE'
  | 'READ_ONLY';

export class MemoryError extends Error {
  constructor(
    readonly code: MemoryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'MemoryError';
  }
}
