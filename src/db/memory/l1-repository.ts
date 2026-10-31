import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MemoryError, type L0Message } from '../../domain/memory/types';
import type { L1Draft, L1Job, L1JobPage, L1JobState, L1Memory } from '../../domain/memory/l1';
import type { L1Repository } from '../../service/memory/l1-ports';
import {
  l0Messages,
  l1Cues,
  l1Jobs,
  l1JobResults,
  l1MaintenanceTasks,
  l1JobSources,
  l1JobSpaces,
  l1Memories,
  l1Sources,
  l1SpaceLinks,
  spaces,
} from './schema';
import { SqliteMemoryRepository } from './repository';
import { assertIndexHealthy, indexStatus, rebuildIndex } from './l1-search-index';
import { invalidateL2ForScopeChange, l1SnapshotHash, recordL2Change } from './l2-invalidation';

export class SqliteL1Repository implements L1Repository {
  private readonly l0: SqliteMemoryRepository;
  constructor(private readonly db: BetterSQLite3Database) {
    this.l0 = new SqliteMemoryRepository(db);
  }

  private loadJob(id: string): L1Job | undefined {
    const row = this.db.select().from(l1Jobs).where(eq(l1Jobs.id, id)).get();
    if (!row) return undefined;
    const sourceIds = this.db
      .select({ id: l1JobSources.l0Id })
      .from(l1JobSources)
      .where(eq(l1JobSources.jobId, id))
      .orderBy(asc(l1JobSources.l0Id))
      .all()
      .map((x) => x.id);
    const relatedSpaceIds = this.db
      .select({ id: l1JobSpaces.spaceId })
      .from(l1JobSpaces)
      .where(eq(l1JobSpaces.jobId, id))
      .orderBy(asc(l1JobSpaces.spaceId))
      .all()
      .map((x) => x.id);
    return {
      id: row.id,
      spaceId: row.spaceId,
      state: row.state as L1JobState,
      sourceIds,
      relatedSpaceIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.failureCode === null ? {} : { failureCode: row.failureCode }),
      ...(row.claimToken === null ? {} : { claimToken: row.claimToken }),
    };
  }

  createJob(job: L1Job, readableSpaceIds: readonly string[]): L1Job {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(l1Jobs).where(eq(l1Jobs.id, job.id)).get();
      if (existing) {
        if (!readableSpaceIds.includes(existing.spaceId))
          throw new MemoryError('SOURCE_CONFLICT', 'Job ID is unavailable.');
        const old = this.loadJob(job.id)!;
        if (
          old.spaceId !== job.spaceId ||
          JSON.stringify(old.sourceIds) !== JSON.stringify([...job.sourceIds].sort()) ||
          JSON.stringify(old.relatedSpaceIds) !== JSON.stringify([...job.relatedSpaceIds].sort())
        ) {
          throw new MemoryError(
            'SOURCE_CONFLICT',
            'Job ID is already associated with different input.'
          );
        }
        return old;
      }
      for (const id of job.sourceIds) {
        const source = this.l0.getMessage(id, readableSpaceIds);
        if (!source) throw new MemoryError('INVALID_INPUT', 'An L0 source is unavailable.');
      }
      for (const id of job.relatedSpaceIds) {
        if (
          !readableSpaceIds.includes(id) ||
          !tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id)).get()
        ) {
          throw new MemoryError('INVALID_INPUT', 'A related space is unavailable.');
        }
      }
      tx.insert(l1Jobs)
        .values({
          id: job.id,
          spaceId: job.spaceId,
          state: job.state,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
        .run();
      tx.insert(l1JobSources)
        .values(job.sourceIds.map((l0Id) => ({ jobId: job.id, l0Id })))
        .run();
      if (job.relatedSpaceIds.length)
        tx.insert(l1JobSpaces)
          .values(job.relatedSpaceIds.map((spaceId) => ({ jobId: job.id, spaceId })))
          .run();
      return this.loadJob(job.id)!;
    });
  }

  getJob(id: string, readableSpaceIds: readonly string[]): L1Job | undefined {
    if (!readableSpaceIds.length) return undefined;
    const row = this.db
      .select({ id: l1Jobs.id })
      .from(l1Jobs)
      .where(and(eq(l1Jobs.id, id), inArray(l1Jobs.spaceId, [...readableSpaceIds])))
      .get();
    if (!row) return undefined;
    const job = this.loadJob(id)!;
    if (job.relatedSpaceIds.some((spaceId) => !readableSpaceIds.includes(spaceId)))
      return undefined;
    if (job.sourceIds.some((sourceId) => !this.l0.getMessage(sourceId, readableSpaceIds)))
      return undefined;
    return job;
  }

  listJobs(
    spaceId: string,
    state: L1JobState | undefined,
    afterId: string | undefined,
    limit: number,
    readableSpaceIds: readonly string[]
  ): L1JobPage {
    if (!readableSpaceIds.length) return { jobs: [] };
    const deniedSources = this.db
      .select({ id: l1JobSources.l0Id })
      .from(l1JobSources)
      .leftJoin(l0Messages, eq(l1JobSources.l0Id, l0Messages.id))
      .where(
        and(
          eq(l1JobSources.jobId, l1Jobs.id),
          or(isNull(l0Messages.id), notInArray(l0Messages.spaceId, [...readableSpaceIds]))
        )
      );
    const deniedSpaces = this.db
      .select({ id: l1JobSpaces.spaceId })
      .from(l1JobSpaces)
      .where(
        and(
          eq(l1JobSpaces.jobId, l1Jobs.id),
          notInArray(l1JobSpaces.spaceId, [...readableSpaceIds])
        )
      );
    const rows = this.db
      .select({ id: l1Jobs.id })
      .from(l1Jobs)
      .where(
        and(
          eq(l1Jobs.spaceId, spaceId),
          notExists(deniedSources),
          notExists(deniedSpaces),
          ...(state === undefined ? [] : [eq(l1Jobs.state, state)]),
          ...(afterId === undefined ? [] : [gt(l1Jobs.id, afterId)])
        )
      )
      .orderBy(asc(l1Jobs.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      jobs: page
        .map((row) => this.getJob(row.id, readableSpaceIds))
        .filter((job): job is L1Job => job !== undefined),
      ...(rows.length > limit ? { nextId: page[page.length - 1].id } : {}),
    };
  }

  claimJob(
    id: string,
    writableSpaceIds: readonly string[],
    token: string,
    now: string
  ): L1Job | undefined {
    if (!writableSpaceIds.length) return undefined;
    return this.db.transaction((tx) => {
      const row = tx
        .update(l1Jobs)
        .set({ state: 'running', claimToken: token, updatedAt: now, failureCode: null })
        .where(
          and(
            eq(l1Jobs.id, id),
            eq(l1Jobs.state, 'pending'),
            inArray(l1Jobs.spaceId, [...writableSpaceIds])
          )
        )
        .returning()
        .get();
      return row ? this.loadJob(id) : undefined;
    });
  }

  getSources(ids: readonly string[], readableSpaceIds: readonly string[]): L0Message[] {
    const messages = ids.map((id) => this.l0.getMessage(id, readableSpaceIds));
    if (messages.some((message) => !message))
      throw new MemoryError('INVALID_INPUT', 'An L0 source is unavailable.');
    return (messages as L0Message[]).sort((a, b) => a.sequence - b.sequence);
  }

  completeJob(
    job: L1Job,
    input: readonly L0Message[],
    drafts: readonly L1Draft[],
    now: string
  ): void {
    this.db.transaction((tx) => {
      const result = tx
        .update(l1Jobs)
        .set({ state: 'succeeded', claimToken: null, updatedAt: now })
        .where(
          and(
            eq(l1Jobs.id, job.id),
            eq(l1Jobs.state, 'running'),
            eq(l1Jobs.claimToken, job.claimToken!)
          )
        )
        .returning()
        .get();
      if (!result)
        throw new MemoryError('JOB_NOT_PENDING', 'The extraction job is no longer running.');
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
        ) {
          throw new MemoryError('SOURCE_CONFLICT', 'An extraction source changed before commit.');
        }
      }
      for (const draft of drafts) {
        const memoryId = randomUUID();
        tx.insert(l1Memories)
          .values({
            id: memoryId,
            jobId: job.id,
            spaceId: job.spaceId,
            content: draft.content,
            abstraction: draft.abstraction,
            maintenanceStatus: 'pending',
            createdAt: now,
          })
          .run();
        tx.insert(l1JobResults).values({ jobId: job.id, memoryId }).run();
        tx.insert(l1MaintenanceTasks)
          .values({
            memoryId,
            spaceId: job.spaceId,
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
        const sourceSpaces = draft.sourceIds.map(
          (id) => input.find((source) => source.id === id)!.spaceId
        );
        const relatedSpaceIds = [...new Set([...draft.relatedSpaceIds, ...sourceSpaces])].filter(
          (id) => id !== job.spaceId
        );
        if (relatedSpaceIds.length)
          tx.insert(l1SpaceLinks)
            .values(relatedSpaceIds.map((spaceId) => ({ memoryId, spaceId })))
            .run();
      }
    });
  }

  failJob(
    id: string,
    token: string,
    state: 'failed' | 'unknown',
    failureCode: string,
    now: string
  ): void {
    const row = this.db
      .update(l1Jobs)
      .set({ state, claimToken: null, updatedAt: now, failureCode })
      .where(and(eq(l1Jobs.id, id), eq(l1Jobs.state, 'running'), eq(l1Jobs.claimToken, token)))
      .returning()
      .get();
    if (!row) throw new MemoryError('JOB_NOT_PENDING', 'The extraction job is no longer running.');
  }

  retryJob(id: string, state: 'failed' | 'unknown', now: string): L1Job | undefined {
    return this.db.transaction((tx) => {
      const row = tx
        .update(l1Jobs)
        .set({ state: 'pending', claimToken: null, failureCode: null, updatedAt: now })
        .where(and(eq(l1Jobs.id, id), eq(l1Jobs.state, state)))
        .returning()
        .get();
      return row ? this.loadJob(id) : undefined;
    });
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
        if (row.maintenanceStatus === 'complete') {
          invalidateL2ForScopeChange(tx, id, now);
          const hash = l1SnapshotHash(tx, id);
          if (hash)
            recordL2Change(tx, {
              l1Id: id,
              ownerSpaceId: row.spaceId,
              kind: 'scope_changed',
              l1Hash: hash,
              now,
            });
        }
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

  listJobMemories(jobId: string, readableSpaceIds: readonly string[]): L1Memory[] {
    if (!readableSpaceIds.length) return [];
    const sharedWithJob = this.db
      .select({ id: l1SpaceLinks.memoryId })
      .from(l1SpaceLinks)
      .where(
        and(eq(l1SpaceLinks.memoryId, l1Memories.id), eq(l1SpaceLinks.spaceId, l1Jobs.spaceId))
      );
    return this.db
      .select({ id: l1Memories.id })
      .from(l1Memories)
      .innerJoin(l1JobResults, eq(l1JobResults.memoryId, l1Memories.id))
      .innerJoin(l1Jobs, eq(l1Jobs.id, l1JobResults.jobId))
      .where(
        and(
          eq(l1JobResults.jobId, jobId),
          inArray(l1Jobs.spaceId, [...readableSpaceIds]),
          or(inArray(l1Memories.spaceId, [...readableSpaceIds]), exists(sharedWithJob))
        )
      )
      .orderBy(asc(l1Memories.id))
      .all()
      .map((row) => this.loadMemory(row.id, readableSpaceIds)!);
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
