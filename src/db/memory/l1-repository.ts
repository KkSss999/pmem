import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MemoryError, type L0Message } from '../../domain/memory/types';
import type { L1Draft, L1Memory } from '../../domain/memory/l1';
import type { L1Repository } from '../../service/memory/l1-ports';
import {
  l0Messages,
  l1Cues,
  l1MaintenanceTasks,
  l1Memories,
  l1Sources,
  l1SpaceLinks,
  l2L1Links,
  spaces,
} from './schema';
import { SqliteMemoryRepository } from './repository';
import { assertIndexHealthy, indexStatus, rebuildIndex } from './l1-search-index';
import { invalidateL2ForScopeChange } from './scope-propagation';

export class SqliteL1Repository implements L1Repository {
  private readonly l0: SqliteMemoryRepository;
  constructor(private readonly db: BetterSQLite3Database) {
    this.l0 = new SqliteMemoryRepository(db);
  }

  commitStream(input: readonly L0Message[], drafts: readonly L1Draft[], now: string): L1Memory[] {
    if (!input.length) throw new MemoryError('INVALID_INPUT', 'A stream source is required.');
    if (input.some((message) => message.spaceId !== input[0].spaceId))
      throw new MemoryError('INVALID_INPUT', 'A commit must stay inside one space.');
    const created: string[] = [];
    this.db.transaction(
      (tx) => {
        for (const old of input) {
          const row = tx.select().from(l0Messages).where(eq(l0Messages.id, old.id)).get();
          if (
            !row ||
            row.content !== old.content ||
            row.spaceId !== old.spaceId ||
            row.role !== old.role ||
            row.sequence !== old.sequence ||
            row.recordedAt !== old.recordedAt ||
            (row.occurredAt ?? undefined) !== old.occurredAt ||
            (row.sessionId ?? undefined) !== old.sessionId ||
            (row.source ?? undefined) !== old.source ||
            (row.sourceEventId ?? undefined) !== old.sourceEventId
          )
            throw new MemoryError('SOURCE_CONFLICT', 'A stream source changed before commit.');
        }
        const jobId = `stream:${input[0].id}`;
        const spaceId = input[0].spaceId;
        for (const draft of drafts) {
          const memoryId = randomUUID();
          tx.insert(l1Memories)
            .values({
              id: memoryId,
              jobId,
              spaceId,
              content: draft.content,
              abstraction: draft.abstraction,
              maintenanceStatus: 'pending',
              createdAt: now,
            })
            .run();
          tx.insert(l1MaintenanceTasks)
            .values({
              memoryId,
              spaceId,
              state: 'pending',
              resultMemoryId: memoryId,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          tx.insert(l1Sources)
            .values(draft.sourceIds.map((l0Id) => ({ memoryId, l0Id })))
            .run();
          if (draft.cues.length)
            tx.insert(l1Cues)
              .values(draft.cues.map((cue) => ({ memoryId, cue })))
              .run();
          const sourceSpaces = draft.sourceIds
            .map((id) => input.find((source) => source.id === id)?.spaceId)
            .filter((id): id is string => !!id);
          const relatedSpaceIds = [...new Set([...draft.relatedSpaceIds, ...sourceSpaces])].filter(
            (id) => id !== spaceId
          );
          if (relatedSpaceIds.length)
            tx.insert(l1SpaceLinks)
              .values(relatedSpaceIds.map((spaceId) => ({ memoryId, spaceId })))
              .run();
          created.push(memoryId);
        }
      },
      { behavior: 'immediate' }
    );
    return created.map((id) =>
      this.loadMemory(
        id,
        input.map((item) => item.spaceId)
      )!
    );
  }

  getMemory(id: string, readableSpaceIds: readonly string[]): L1Memory | undefined {
    if (!readableSpaceIds.length) return undefined;
    const row = this.db
      .select({ id: l1Memories.id })
      .from(l1Memories)
      .where(and(eq(l1Memories.id, id), inArray(l1Memories.spaceId, [...readableSpaceIds])))
      .get();
    if (!row) return undefined;
    return this.loadMemory(id, readableSpaceIds);
  }

  updateSpaceLinks(
    id: string,
    relatedSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    writableSpaceIds: readonly string[],
    now: string
  ): L1Memory {
    return this.db.transaction(
      (tx) => {
        const row = tx.select().from(l1Memories).where(eq(l1Memories.id, id)).get();
        if (!row) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
        if (!writableSpaceIds.includes(row.spaceId))
          throw new MemoryError('ACCESS_DENIED', 'The L1 owner space is not writable.');
        const next = [...new Set(relatedSpaceIds)]
          .filter((spaceId) => spaceId !== row.spaceId)
          .sort();
        for (const spaceId of next) {
          if (
            !readableSpaceIds.includes(spaceId) ||
            !tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).get()
          )
            throw new MemoryError('ACCESS_DENIED', 'A related space is not readable.');
        }
        const current = tx
          .select({ spaceId: l1SpaceLinks.spaceId })
          .from(l1SpaceLinks)
          .where(eq(l1SpaceLinks.memoryId, id))
          .orderBy(asc(l1SpaceLinks.spaceId))
          .all()
          .map((item) => item.spaceId);
        if (JSON.stringify(current) === JSON.stringify(next))
          return this.loadMemory(id, readableSpaceIds)!;
        tx.delete(l1SpaceLinks).where(eq(l1SpaceLinks.memoryId, id)).run();
        if (next.length)
          tx.insert(l1SpaceLinks)
            .values(next.map((spaceId) => ({ memoryId: id, spaceId })))
            .run();
        invalidateL2ForScopeChange(tx, id, now);
        return this.loadMemory(id, readableSpaceIds)!;
      },
      { behavior: 'immediate' }
    );
  }

  private loadMemory(id: string, readableSpaceIds: readonly string[]): L1Memory | undefined {
    const row = this.db.select().from(l1Memories).where(eq(l1Memories.id, id)).get();
    if (!row) return undefined;
    const cues = this.db
      .select({ cue: l1Cues.cue })
      .from(l1Cues)
      .where(eq(l1Cues.memoryId, id))
      .orderBy(asc(l1Cues.cue))
      .all()
      .map((x) => x.cue);
    const allSources = this.db
      .select({ id: l1Sources.l0Id, spaceId: l0Messages.spaceId })
      .from(l1Sources)
      .leftJoin(l0Messages, eq(l1Sources.l0Id, l0Messages.id))
      .where(eq(l1Sources.memoryId, id))
      .orderBy(asc(l1Sources.l0Id))
      .all();
    const sourceIds = allSources
      .filter((x) => x.spaceId !== null && readableSpaceIds.includes(x.spaceId))
      .map((x) => x.id);
    const relatedSpaceIds = this.db
      .select({ id: l1SpaceLinks.spaceId })
      .from(l1SpaceLinks)
      .where(
        and(eq(l1SpaceLinks.memoryId, id), inArray(l1SpaceLinks.spaceId, [...readableSpaceIds]))
      )
      .orderBy(asc(l1SpaceLinks.spaceId))
      .all()
      .map((x) => x.id);
    return {
      id: row.id,
      jobId: row.jobId,
      spaceId: row.spaceId,
      content: row.content,
      abstraction: row.abstraction,
      cues,
      sourceIds,
      sourcesComplete: sourceIds.length === allSources.length,
      relatedSpaceIds,
      maintenanceStatus: row.maintenanceStatus as L1Memory['maintenanceStatus'],
      createdAt: row.createdAt,
    };
  }

  uncoveredMemoryIds(
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): string[] {
    if (!anchoredSpaceIds.length || !readableSpaceIds.length || limit < 1) return [];
    const rows = this.db
      .select({ id: l1Memories.id })
      .from(l1Memories)
      .where(
        and(
          inArray(l1Memories.spaceId, [...anchoredSpaceIds]),
          inArray(l1Memories.spaceId, [...readableSpaceIds]),
          eq(l1Memories.maintenanceStatus, 'complete'),
          notExists(
            this.db
              .select({ id: l2L1Links.l1Id })
              .from(l2L1Links)
              .where(eq(l2L1Links.l1Id, l1Memories.id))
          )
        )
      )
      .orderBy(asc(l1Memories.createdAt), asc(l1Memories.id))
      .limit(limit)
      .all()
      .map((row) => row.id);
    return rows;
  }

  checkSearchIndex(): import('../../domain/memory/l1').L1IndexStatus {
    return this.db.transaction(() => indexStatus(this.db));
  }

  rebuildSearchIndex(): void {
    rebuildIndex(this.db);
  }

  searchMemories(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L1Memory[] {
    if (!anchoredSpaceIds.length || !readableSpaceIds.length) return [];
    const anchors = sql.join(
      anchoredSpaceIds.map((id) => sql`${id}`),
      sql`, `
    );
    const matches = terms.map((term) =>
      [...term].length >= 3
        ? sql`m.id IN (SELECT memory_id FROM memory_l1_search WHERE memory_l1_search MATCH ${`"${term.replaceAll('"', '""')}"`})`
        : sql`EXISTS (SELECT 1 FROM memory_l1_search s WHERE s.memory_id = m.id AND
            (instr(lower(s.content), ${term}) > 0 OR instr(lower(s.abstraction), ${term}) > 0 OR instr(lower(s.cues), ${term}) > 0))`
    );
    // shortcut: short words require a scan; add an indexed short-term strategy after evaluation.
    const score = sql.join(
      matches.map((match) => sql`(CASE WHEN ${match} THEN 1 ELSE 0 END)`),
      sql` + `
    );
    return this.db.transaction(() => {
      // shortcut: full index validation runs per recall; replace only after measured, reliable incremental checks exist.
      assertIndexHealthy(this.db);
      if (!terms.length) return [];
      const rows = this.db.all<{ id: string }>(sql`
      SELECT m.id FROM memory_l1 m
      WHERE (m.space_id IN (${anchors}) OR EXISTS (
          SELECT 1 FROM memory_l1_space_links link
          WHERE link.memory_id = m.id AND link.space_id IN (${anchors})
        ))
        AND (${sql.join(matches, sql` OR `)})
      ORDER BY (${score}) DESC, m.id ASC
      LIMIT ${limit}
    `);
      return rows
        .map((row) => this.loadMemory(row.id, readableSpaceIds))
        .filter((memory): memory is L1Memory => memory !== undefined);
    });
  }
}
