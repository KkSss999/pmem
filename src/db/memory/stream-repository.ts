import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  MEMORY_STREAM_KINDS,
  type EnqueueMemoryStreamItem,
  type MemoryStreamItem,
  type MemoryStreamKind,
  type MemoryStreamState,
} from '../../domain/memory/stream';
import { MemoryError } from '../../domain/memory/types';
import { memoryStreamQueue } from './stream-schema';

type Row = typeof memoryStreamQueue.$inferSelect;

function identifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new MemoryError('INVALID_INPUT', `${field} is required.`);
}

function map(row: Row): MemoryStreamItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scopeId: row.scopeId,
    kind: row.kind as MemoryStreamKind,
    subjectId: row.subjectId,
    sourceHash: row.sourceHash,
    state: row.state as MemoryStreamState,
    attempt: row.attempt,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
  };
}

export class MemoryStreamRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  enqueue(input: EnqueueMemoryStreamItem, now = new Date().toISOString()): MemoryStreamItem {
    identifier(input.workspaceId, 'workspaceId');
    identifier(input.scopeId, 'scopeId');
    identifier(input.subjectId, 'subjectId');
    identifier(input.sourceHash, 'sourceHash');
    if (!MEMORY_STREAM_KINDS.includes(input.kind))
      throw new MemoryError('INVALID_INPUT', 'Invalid memory stream kind.');
    const id = randomUUID();
    this.db
      .insert(memoryStreamQueue)
      .values({
        id,
        workspaceId: input.workspaceId,
        scopeId: input.scopeId,
        kind: input.kind,
        subjectId: input.subjectId,
        sourceHash: input.sourceHash,
        state: 'pending',
        attempt: 0,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    return this.find(
      input.workspaceId,
      input.scopeId,
      input.kind,
      input.subjectId,
      input.sourceHash
    )!;
  }

  find(
    workspaceId: string,
    scopeId: string,
    kind: MemoryStreamKind,
    subjectId: string,
    sourceHash: string
  ): MemoryStreamItem | undefined {
    const row = this.db
      .select()
      .from(memoryStreamQueue)
      .where(
        and(
          eq(memoryStreamQueue.workspaceId, workspaceId),
          eq(memoryStreamQueue.scopeId, scopeId),
          eq(memoryStreamQueue.kind, kind),
          eq(memoryStreamQueue.subjectId, subjectId),
          eq(memoryStreamQueue.sourceHash, sourceHash)
        )
      )
      .get();
    return row ? map(row) : undefined;
  }

  next(workspaceId: string, scopeId: string): MemoryStreamItem | undefined {
    const row = this.db
      .select()
      .from(memoryStreamQueue)
      .where(
        and(
          eq(memoryStreamQueue.workspaceId, workspaceId),
          eq(memoryStreamQueue.scopeId, scopeId),
          eq(memoryStreamQueue.state, 'pending')
        )
      )
      .orderBy(asc(memoryStreamQueue.createdAt), asc(memoryStreamQueue.id))
      .get();
    return row ? map(row) : undefined;
  }

  claim(id: string, now = new Date().toISOString()): MemoryStreamItem {
    const row = this.db
      .update(memoryStreamQueue)
      .set({ state: 'running', startedAt: now, errorCode: null })
      .where(and(eq(memoryStreamQueue.id, id), eq(memoryStreamQueue.state, 'pending')))
      .returning()
      .get();
    if (!row) throw new MemoryError('JOB_NOT_PENDING', 'Memory stream item is not pending.');
    return map(row);
  }

  finish(
    id: string,
    state: 'done' | 'failed' | 'unknown',
    errorCode: string | undefined,
    now = new Date().toISOString()
  ): MemoryStreamItem {
    const row = this.db
      .update(memoryStreamQueue)
      .set({ state, errorCode: errorCode ?? null, finishedAt: now })
      .where(and(eq(memoryStreamQueue.id, id), eq(memoryStreamQueue.state, 'running')))
      .returning()
      .get();
    if (!row) throw new MemoryError('JOB_NOT_PENDING', 'Memory stream item is not running.');
    return map(row);
  }

  retry(id: string, now = new Date().toISOString()): MemoryStreamItem {
    const row = this.db
      .update(memoryStreamQueue)
      .set({ state: 'pending', errorCode: null, startedAt: null, finishedAt: null, attempt: 1 })
      .where(
        and(eq(memoryStreamQueue.id, id), inArray(memoryStreamQueue.state, ['failed', 'unknown']))
      )
      .returning()
      .get();
    if (!row) throw new MemoryError('JOB_NOT_PENDING', 'Memory stream item is not retryable.');
    return map(row);
  }

  recoverRunning(workspaceId: string, scopeId: string, now = new Date().toISOString()): number {
    const rows = this.db
      .update(memoryStreamQueue)
      .set({ state: 'unknown', errorCode: 'INTERRUPTED', finishedAt: now })
      .where(
        and(
          eq(memoryStreamQueue.workspaceId, workspaceId),
          eq(memoryStreamQueue.scopeId, scopeId),
          eq(memoryStreamQueue.state, 'running')
        )
      )
      .returning({ id: memoryStreamQueue.id })
      .all();
    return rows.length;
  }
}
