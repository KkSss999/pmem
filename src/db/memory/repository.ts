import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  MemoryError,
  type AppendL0Input,
  type AppendL0Result,
  type L0Message,
  type L0Page,
  type MemorySpace,
} from '../../domain/memory/types';
import type { MemoryRepository } from '../../service/memory/ports';
import { l0Messages, spaces } from './schema';

type MessageRow = typeof l0Messages.$inferSelect;

function toMessage(row: MessageRow): L0Message {
  return {
    id: row.id,
    sequence: row.sequence,
    spaceId: row.spaceId,
    role: row.role as L0Message['role'],
    content: row.content,
    ...(row.source === null ? {} : { source: row.source }),
    ...(row.sourceEventId === null ? {} : { sourceEventId: row.sourceEventId }),
    ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
    ...(row.occurredAt === null ? {} : { occurredAt: row.occurredAt }),
    recordedAt: row.recordedAt,
  };
}

function toSpace(row: typeof spaces.$inferSelect): MemorySpace {
  return { ...row, kind: row.kind as MemorySpace['kind'] };
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  getSpace(id: string): MemorySpace | undefined {
    const row = this.db.select().from(spaces).where(eq(spaces.id, id)).get();
    return row ? toSpace(row) : undefined;
  }

  listSpaces(ids: readonly string[]): MemorySpace[] {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(spaces)
      .where(inArray(spaces.id, [...new Set(ids)]))
      .orderBy(asc(spaces.createdAt), asc(spaces.id))
      .all()
      .map(toSpace);
  }

  createSpace(space: MemorySpace): void {
    this.db.insert(spaces).values(space).run();
  }

  appendMessage(input: AppendL0Input, id: string, recordedAt: string): AppendL0Result {
    return this.db.transaction((tx) => {
      const inserted = tx
        .insert(l0Messages)
        .values({
          id,
          spaceId: input.spaceId,
          role: input.role,
          content: input.content,
          source: input.source ?? null,
          sourceEventId: input.sourceEventId ?? null,
          sessionId: input.sessionId ?? null,
          occurredAt: input.occurredAt ?? null,
          recordedAt,
        })
        .onConflictDoNothing({
          target: [l0Messages.spaceId, l0Messages.source, l0Messages.sourceEventId],
        })
        .returning()
        .get();
      if (inserted) return { message: toMessage(inserted), created: true };
      if (input.source === undefined || input.sourceEventId === undefined) {
        throw new MemoryError('SOURCE_CONFLICT', 'Message insertion had an unexpected conflict.');
      }
      const existing = tx
        .select()
        .from(l0Messages)
        .where(
          and(
            eq(l0Messages.spaceId, input.spaceId),
            eq(l0Messages.source, input.source),
            eq(l0Messages.sourceEventId, input.sourceEventId)
          )
        )
        .get();
      if (
        !existing ||
        existing.role !== input.role ||
        existing.content !== input.content ||
        existing.sessionId !== (input.sessionId ?? null) ||
        existing.occurredAt !== (input.occurredAt ?? null)
      ) {
        throw new MemoryError(
          'SOURCE_CONFLICT',
          'Source event ID is already associated with different message data.'
        );
      }
      return { message: toMessage(existing), created: false };
    });
  }

  getMessage(id: string, readableSpaceIds: readonly string[]): L0Message | undefined {
    if (readableSpaceIds.length === 0) return undefined;
    const row = this.db
      .select()
      .from(l0Messages)
      .where(
        and(eq(l0Messages.id, id), inArray(l0Messages.spaceId, [...new Set(readableSpaceIds)]))
      )
      .get();
    return row ? toMessage(row) : undefined;
  }

  listMessages(
    spaceId: string,
    sessionId: string | undefined,
    afterSequence: number,
    limit: number
  ): L0Page {
    const rows = this.db
      .select()
      .from(l0Messages)
      .where(
        and(
          eq(l0Messages.spaceId, spaceId),
          gt(l0Messages.sequence, afterSequence),
          ...(sessionId === undefined ? [] : [eq(l0Messages.sessionId, sessionId)])
        )
      )
      .orderBy(asc(l0Messages.sequence))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      messages: page.map(toMessage),
      ...(rows.length > limit ? { nextSequence: page[page.length - 1].sequence } : {}),
    };
  }
}
