import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  L2Change,
  L2ChangeState,
  L2Job,
  L2Memory,
  L2ResultState,
} from '../../domain/memory/l2';
import type { L2Repository } from '../../service/memory/l2-ports';
import { MemoryError } from '../../domain/memory/types';
import {
  l0Messages,
  l2Changes,
  l2JobResults,
  l2Jobs,
  l2L0Sources,
  l2L1Links,
  l2Memories,
  l2SpaceLinks,
} from './schema';
import { assertIndexHealthy, indexStatus, rebuildIndex } from './l2-search-index';

export class SqliteL2Repository implements L2Repository {
  constructor(private readonly db: BetterSQLite3Database) {}

  private loadJob(id: string, readableSpaceIds: readonly string[]): L2Job | undefined {
    if (!readableSpaceIds.length) return undefined;
    const row = this.db
      .select()
      .from(l2Jobs)
      .where(and(eq(l2Jobs.id, id), inArray(l2Jobs.ownerSpaceId, [...readableSpaceIds])))
      .get();
    if (!row) return undefined;
    return {
      id: row.id,
      ownerSpaceId: row.ownerSpaceId,
      state: row.state as L2Job['state'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.failureCode === null ? {} : { failureCode: row.failureCode }),
      ...(row.claimToken === null ? {} : { claimToken: row.claimToken }),
      ...(row.promptVersion === null ? {} : { promptVersion: row.promptVersion }),
    };
  }

  private loadChange(row: typeof l2Changes.$inferSelect): L2Change {
    return {
      id: row.id,
      l1Id: row.l1Id,
      ownerSpaceId: row.ownerSpaceId,
      kind: row.kind as L2Change['kind'],
      l1Hash: row.l1Hash,
      ...(row.survivorL1Id === null ? {} : { survivorL1Id: row.survivorL1Id }),
      state: row.state as L2Change['state'],
      ...(row.jobId === null ? {} : { jobId: row.jobId }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      createdAt: row.createdAt,
      ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
    };
  }

  recordChange(change: L2Change): L2Change {
    return this.db.transaction((tx) => {
      tx.delete(l2Changes)
        .where(and(eq(l2Changes.l1Id, change.l1Id), eq(l2Changes.state, 'pending')))
        .run();
      const row = tx
        .insert(l2Changes)
        .values({
          id: change.id,
          l1Id: change.l1Id,
          ownerSpaceId: change.ownerSpaceId,
          kind: change.kind,
          l1Hash: change.l1Hash,
          survivorL1Id: change.survivorL1Id ?? null,
          state: change.state,
          jobId: change.jobId ?? null,
          reason: change.reason ?? null,
          createdAt: change.createdAt,
          processedAt: change.processedAt ?? null,
        })
        .returning()
        .get();
      return this.loadChange(row);
    });
  }

  listChanges(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Change[] {
    if (!readableSpaceIds.includes(ownerSpaceId)) return [];
    return this.db
      .select()
      .from(l2Changes)
      .where(eq(l2Changes.ownerSpaceId, ownerSpaceId))
      .orderBy(desc(l2Changes.createdAt), asc(l2Changes.id))
      .limit(limit)
      .all()
      .map((row) => this.loadChange(row));
  }

  createJob(job: L2Job): L2Job {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(l2Jobs).where(eq(l2Jobs.id, job.id)).get();
      if (existing) {
        if (existing.ownerSpaceId !== job.ownerSpaceId)
          throw new MemoryError('SOURCE_CONFLICT', 'L2 job ID is already in use.');
        return this.loadJob(job.id, [job.ownerSpaceId])!;
      }
      tx.insert(l2Jobs)
        .values({
          id: job.id,
          ownerSpaceId: job.ownerSpaceId,
          state: job.state,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
        .run();
      return this.loadJob(job.id, [job.ownerSpaceId])!;
    });
  }

  getJob(id: string, readableSpaceIds: readonly string[]): L2Job | undefined {
    return this.loadJob(id, readableSpaceIds);
  }

  setPromptVersion(id: string, token: string, version: string, now: string): void {
    const result = this.db
      .update(l2Jobs)
      .set({ promptVersion: version, updatedAt: now })
      .where(and(eq(l2Jobs.id, id), eq(l2Jobs.state, 'running'), eq(l2Jobs.claimToken, token)))
      .run();
    if (!result.changes)
      throw new MemoryError('JOB_NOT_PENDING', 'The L2 job is no longer running.');
  }

  claim(
    id: string,
    writableSpaceIds: readonly string[],
    token: string,
    now: string
  ): { job: L2Job; changes: L2Change[] } | undefined {
    if (!writableSpaceIds.length) return undefined;
    return this.db.transaction(
      (tx) => {
        const job = tx
          .select()
          .from(l2Jobs)
          .where(and(eq(l2Jobs.id, id), eq(l2Jobs.state, 'pending')))
          .get();
        if (!job || !writableSpaceIds.includes(job.ownerSpaceId)) return undefined;
        const pending = tx
          .select()
          .from(l2Changes)
          .where(and(eq(l2Changes.state, 'pending'), eq(l2Changes.ownerSpaceId, job.ownerSpaceId)))
          .orderBy(asc(l2Changes.createdAt), asc(l2Changes.id))
          .limit(10)
          .all();
        if (!pending.length) return undefined;
        tx.update(l2Jobs)
          .set({ state: 'running', claimToken: token, updatedAt: now, failureCode: null })
          .where(and(eq(l2Jobs.id, id), eq(l2Jobs.state, 'pending')))
          .run();
        tx.update(l2Changes)
          .set({ state: 'claimed', jobId: id })
          .where(
            inArray(
              l2Changes.id,
              pending.map((row) => row.id)
            )
          )
          .run();
        return {
          job: this.loadJob(id, writableSpaceIds)!,
          changes: pending.map((row) => this.loadChange({ ...row, state: 'claimed', jobId: id })),
        };
      },
      { behavior: 'immediate' }
    );
  }

  getMemory(id: string, readableSpaceIds: readonly string[]): L2Memory | undefined {
    return this.loadMemory(id, readableSpaceIds);
  }

  private loadMemory(id: string, readableSpaceIds: readonly string[]): L2Memory | undefined {
    if (!readableSpaceIds.length) return undefined;
    const row = this.db.select().from(l2Memories).where(eq(l2Memories.id, id)).get();
    if (!row) return undefined;
    const links = this.db
      .select({ spaceId: l2SpaceLinks.spaceId })
      .from(l2SpaceLinks)
      .where(eq(l2SpaceLinks.l2Id, id))
      .all();
    const readableLinks = links
      .map((link) => link.spaceId)
      .filter((spaceId) => readableSpaceIds.includes(spaceId));
    if (!readableSpaceIds.includes(row.ownerSpaceId) && !readableLinks.length) return undefined;
    const l1Ids = this.db
      .select({ id: l2L1Links.l1Id })
      .from(l2L1Links)
      .where(eq(l2L1Links.l2Id, id))
      .orderBy(asc(l2L1Links.l1Id))
      .all()
      .map((item) => item.id);
    const allSources = this.db
      .select({ id: l2L0Sources.l0Id, spaceId: l0Messages.spaceId })
      .from(l2L0Sources)
      .leftJoin(l0Messages, eq(l2L0Sources.l0Id, l0Messages.id))
      .where(eq(l2L0Sources.l2Id, id))
      .orderBy(asc(l2L0Sources.l0Id))
      .all();
    const sourceIds = allSources
      .filter((item) => item.spaceId !== null && readableSpaceIds.includes(item.spaceId))
      .map((item) => item.id);
    return {
      id: row.id,
      ownerSpaceId: row.ownerSpaceId,
      title: row.title,
      summary: row.summary,
      body: row.body,
      contentHash: row.contentHash,
      needsUpdate: row.needsUpdate === 1,
      visible: row.visible === 1,
      generationId: row.generationId,
      relatedSpaceIds: readableLinks.sort(),
      l1Ids,
      sourceIds,
      sourcesComplete: sourceIds.length === allSources.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listCandidates(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[] {
    return this.listMemories(ownerSpaceId, readableSpaceIds, limit);
  }

  listLinkedCandidates(
    ownerSpaceId: string,
    l1Ids: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[] {
    if (!l1Ids.length || !readableSpaceIds.length) return [];
    const rows = this.db
      .select({ id: l2Memories.id })
      .from(l2L1Links)
      .innerJoin(l2Memories, eq(l2Memories.id, l2L1Links.l2Id))
      .where(
        and(
          eq(l2Memories.ownerSpaceId, ownerSpaceId),
          eq(l2Memories.visible, 1),
          inArray(l2L1Links.l1Id, [...l1Ids])
        )
      )
      .groupBy(l2Memories.id)
      .limit(limit)
      .all();
    return rows
      .map((row) => this.loadMemory(row.id, readableSpaceIds))
      .filter((memory): memory is L2Memory => memory !== undefined);
  }

  listMemories(
    ownerSpaceId: string,
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[] {
    if (!readableSpaceIds.length) return [];
    const rows = this.db
      .select({ id: l2Memories.id })
      .from(l2Memories)
      .where(and(eq(l2Memories.ownerSpaceId, ownerSpaceId), eq(l2Memories.visible, 1)))
      .orderBy(desc(l2Memories.updatedAt), asc(l2Memories.id))
      .limit(limit)
      .all();
    return rows
      .map((row) => this.loadMemory(row.id, readableSpaceIds))
      .filter((memory): memory is L2Memory => memory !== undefined);
  }

  private writeLinks(
    tx: Pick<BetterSQLite3Database, 'delete' | 'insert'>,
    l2Id: string,
    input: {
      l1Ids: readonly string[];
      sourceIds: readonly string[];
      relatedSpaceIds: readonly string[];
      generationId: string;
    }
  ): void {
    tx.delete(l2L1Links).where(eq(l2L1Links.l2Id, l2Id)).run();
    tx.delete(l2L0Sources).where(eq(l2L0Sources.l2Id, l2Id)).run();
    tx.delete(l2SpaceLinks).where(eq(l2SpaceLinks.l2Id, l2Id)).run();
    if (input.l1Ids.length)
      tx.insert(l2L1Links)
        .values(input.l1Ids.map((l1Id) => ({ l2Id, l1Id })))
        .run();
    if (input.sourceIds.length)
      tx.insert(l2L0Sources)
        .values(input.sourceIds.map((l0Id) => ({ l2Id, l0Id, generationId: input.generationId })))
        .run();
    if (input.relatedSpaceIds.length)
      tx.insert(l2SpaceLinks)
        .values(input.relatedSpaceIds.map((spaceId) => ({ l2Id, spaceId })))
        .run();
  }

  applyCreate(
    job: L2Job,
    input: {
      title: string;
      summary: string;
      body: string;
      l1Ids: readonly string[];
      sourceIds: readonly string[];
      relatedSpaceIds: readonly string[];
      generationId: string;
      contentHash: string;
      now: string;
    }
  ): L2Memory {
    const id = randomUUID();
    this.db.transaction(
      (tx) => {
        tx.insert(l2Memories)
          .values({
            id,
            ownerSpaceId: job.ownerSpaceId,
            title: input.title,
            summary: input.summary,
            body: input.body,
            contentHash: input.contentHash,
            needsUpdate: 0,
            visible: 1,
            generationId: input.generationId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();
        this.writeLinks(tx, id, input);
      },
      { behavior: 'immediate' }
    );
    return this.loadMemory(id, [job.ownerSpaceId, ...input.relatedSpaceIds])!;
  }

  applyUpdate(
    job: L2Job,
    input: {
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
    }
  ): L2Memory {
    this.db.transaction(
      (tx) => {
        const current = tx.select().from(l2Memories).where(eq(l2Memories.id, input.l2Id)).get();
        if (!current || current.ownerSpaceId !== job.ownerSpaceId)
          throw new MemoryError('L2_STALE_INPUT', 'The L2 memory is no longer available.');
        if (current.contentHash !== input.expectedHash)
          throw new MemoryError('L2_STALE_INPUT', 'The L2 memory changed before commit.');
        const currentLinks = tx
          .select({ id: l2L1Links.l1Id })
          .from(l2L1Links)
          .where(eq(l2L1Links.l2Id, input.l2Id))
          .orderBy(asc(l2L1Links.l1Id))
          .all()
          .map((item) => item.id);
        if (JSON.stringify(currentLinks) !== JSON.stringify([...input.expectedL1Ids].sort()))
          throw new MemoryError('L2_STALE_INPUT', 'The L2 links changed before commit.');
        tx.update(l2Memories)
          .set({
            title: input.title,
            summary: input.summary,
            body: input.body,
            contentHash: input.contentHash,
            needsUpdate: 0,
            visible: 1,
            generationId: input.generationId,
            updatedAt: input.now,
          })
          .where(eq(l2Memories.id, input.l2Id))
          .run();
        this.writeLinks(tx, input.l2Id, input);
      },
      { behavior: 'immediate' }
    );
    return this.loadMemory(input.l2Id, [job.ownerSpaceId, ...input.relatedSpaceIds])!;
  }

  refreshChangeHash(id: string, l1Hash: string): void {
    this.db
      .update(l2Changes)
      .set({ l1Hash })
      .where(and(eq(l2Changes.id, id), eq(l2Changes.state, 'failed')))
      .run();
  }

  finishChanges(
    ids: readonly string[],
    state: L2ChangeState,
    jobId: string,
    reason: string | undefined,
    now: string
  ): void {
    if (!ids.length) return;
    this.db
      .update(l2Changes)
      .set({ state, jobId, reason: reason ?? null, processedAt: now })
      .where(and(inArray(l2Changes.id, [...ids]), eq(l2Changes.jobId, jobId)))
      .run();
  }

  recordResult(
    jobId: string,
    resultIndex: number,
    state: L2ResultState,
    action: 'create' | 'update',
    l2Id: string | undefined,
    errorCode: string | undefined,
    now: string
  ): void {
    this.db
      .insert(l2JobResults)
      .values({
        id: randomUUID(),
        jobId,
        resultIndex,
        state,
        action,
        l2Id: l2Id ?? null,
        errorCode: errorCode ?? null,
        createdAt: now,
      })
      .run();
  }

  finishJob(
    id: string,
    token: string,
    state: 'succeeded' | 'partial' | 'failed' | 'unknown',
    failureCode: string | undefined,
    now: string
  ): void {
    const result = this.db
      .update(l2Jobs)
      .set({ state, claimToken: null, failureCode: failureCode ?? null, updatedAt: now })
      .where(and(eq(l2Jobs.id, id), eq(l2Jobs.state, 'running'), eq(l2Jobs.claimToken, token)))
      .run();
    if (!result.changes)
      throw new MemoryError('JOB_NOT_PENDING', 'The L2 job is no longer running.');
  }

  retryJob(id: string, state: 'failed' | 'unknown' | 'partial', now: string): L2Job | undefined {
    return this.db.transaction((tx) => {
      const row = tx
        .update(l2Jobs)
        .set({ state: 'pending', claimToken: null, failureCode: null, updatedAt: now })
        .where(and(eq(l2Jobs.id, id), eq(l2Jobs.state, state)))
        .returning()
        .get();
      if (!row) return undefined;
      tx.delete(l2JobResults).where(eq(l2JobResults.jobId, id)).run();
      tx.update(l2Changes)
        .set({ state: 'pending', jobId: null, reason: null, processedAt: null })
        .where(and(eq(l2Changes.jobId, id), eq(l2Changes.state, 'failed')))
        .run();
      return this.loadJob(id, [row.ownerSpaceId])!;
    });
  }

  checkSearchIndex(): import('../../domain/memory/l2').L2IndexStatus {
    return this.db.transaction(() => indexStatus(this.db));
  }

  rebuildSearchIndex(): void {
    rebuildIndex(this.db);
  }

  search(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    limit: number
  ): L2Memory[] {
    if (!terms.length || !anchoredSpaceIds.length || !readableSpaceIds.length) return [];
    const anchors = sql.join(
      anchoredSpaceIds.map((id) => sql`${id}`),
      sql`, `
    );
    const matches = terms.map((term) =>
      [...term].length >= 3
        ? sql`m.id IN (SELECT l2_id FROM memory_l2_search WHERE memory_l2_search MATCH ${`"${term.replaceAll('"', '""')}"`})`
        : sql`EXISTS (SELECT 1 FROM memory_l2_search s WHERE s.l2_id = m.id AND
            (instr(lower(s.title), ${term}) > 0 OR instr(lower(s.summary), ${term}) > 0 OR instr(lower(s.body), ${term}) > 0))`
    );
    const score = sql.join(
      matches.map((match) => sql`(CASE WHEN ${match} THEN 1 ELSE 0 END)`),
      sql` + `
    );
    return this.db.transaction(() => {
      assertIndexHealthy(this.db);
      const rows = this.db.all<{ id: string }>(sql`
        SELECT m.id FROM memory_l2 m
        WHERE m.visible = 1
          AND (m.owner_space_id IN (${anchors}) OR EXISTS (
            SELECT 1 FROM memory_l2_space_links link
            WHERE link.l2_id = m.id AND link.space_id IN (${anchors})
          ))
          AND (${sql.join(matches, sql` OR `)})
        ORDER BY (${score}) DESC, m.updated_at DESC, m.id ASC
        LIMIT ${limit}
      `);
      return rows
        .map((row) => this.loadMemory(row.id, readableSpaceIds))
        .filter((memory): memory is L2Memory => memory !== undefined);
    });
  }
}
