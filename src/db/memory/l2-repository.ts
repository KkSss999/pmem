import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { L2Memory } from '../../domain/memory/l2';
import type { L2Repository } from '../../service/memory/l2-ports';
import { MemoryError } from '../../domain/memory/types';
import { l0Messages, l2L0Sources, l2L1Links, l2Memories, l2SpaceLinks } from './schema';
import { assertIndexHealthy, indexStatus, rebuildIndex } from './l2-search-index';
import { invalidateL3ForL2Change } from './scope-propagation';

export class SqliteL2Repository implements L2Repository {
  constructor(private readonly db: BetterSQLite3Database) {}

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
      ...(row.supersededBy === null ? {} : { supersededBy: row.supersededBy }),
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

  applyCreate(input: {
    ownerSpaceId: string;
    title: string;
    summary: string;
    body: string;
    l1Ids: readonly string[];
    sourceIds: readonly string[];
    relatedSpaceIds: readonly string[];
    generationId: string;
    contentHash: string;
    now: string;
  }): L2Memory {
    const id = randomUUID();
    this.db.transaction(
      (tx) => {
        tx.insert(l2Memories)
          .values({
            id,
            ownerSpaceId: input.ownerSpaceId,
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
        invalidateL3ForL2Change(tx, id, input.now);
      },
      { behavior: 'immediate' }
    );
    return this.loadMemory(id, [input.ownerSpaceId, ...input.relatedSpaceIds])!;
  }

  applySupersede(oldL2Id: string, newL2Id: string, expectedHash: string, now: string): void {
    this.db.transaction(
      (tx) => {
        const current = tx.select().from(l2Memories).where(eq(l2Memories.id, oldL2Id)).get();
        if (!current || current.contentHash !== expectedHash)
          throw new MemoryError('L2_STALE_INPUT', 'The L2 memory changed before supersede.');
        const next = tx.select().from(l2Memories).where(eq(l2Memories.id, newL2Id)).get();
        if (!next) throw new MemoryError('L2_STALE_INPUT', 'The replacement L2 is unavailable.');
        tx.update(l2Memories)
          .set({ visible: 0, supersededBy: newL2Id, needsUpdate: 0, updatedAt: now })
          .where(eq(l2Memories.id, oldL2Id))
          .run();
        invalidateL3ForL2Change(tx, oldL2Id, now);
      },
      { behavior: 'immediate' }
    );
  }

  applyUpdate(input: {
    ownerSpaceId: string;
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
  }): L2Memory {
    this.db.transaction(
      (tx) => {
        const current = tx.select().from(l2Memories).where(eq(l2Memories.id, input.l2Id)).get();
        if (!current || current.ownerSpaceId !== input.ownerSpaceId)
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
        invalidateL3ForL2Change(tx, input.l2Id, input.now);
      },
      { behavior: 'immediate' }
    );
    return this.loadMemory(input.l2Id, [input.ownerSpaceId, ...input.relatedSpaceIds])!;
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
