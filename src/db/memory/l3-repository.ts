import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  l3ScopeKey,
  normalizeL3Term,
  type L3ChangeState,
  type L3Job,
  type L3Keyword,
  type L3KeywordKind,
  type L3ResultState,
} from '../../domain/memory/l3';
import { MemoryError } from '../../domain/memory/types';
import type { L3KeywordInput, L3Repository } from '../../service/memory/l3-ports';
import type { L3Change } from '../../domain/memory/l3';
import { l2SnapshotHash, registerL3ChangeForL2 } from './l3-invalidation';
import {
  l2Memories,
  l2SpaceLinks,
  l3Changes,
  l3JobResults,
  l3Jobs,
  l3KeywordL2Links,
  l3KeywordSpaces,
  l3Keywords,
  spaces,
} from './schema';
import { assertIndexHealthy, indexStatus, rebuildIndex } from './l3-search-index';

function aliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

export class SqliteL3Repository implements L3Repository {
  constructor(private readonly db: BetterSQLite3Database) {}

  private loadKeyword(
    id: string,
    readableSpaceIds: readonly string[],
    now: string
  ): L3Keyword | undefined {
    if (!readableSpaceIds.length) return undefined;
    const row = this.db.select().from(l3Keywords).where(eq(l3Keywords.id, id)).get();
    if (!row || row.state !== 'active' || row.expiresAt <= now) return undefined;
    const relatedSpaceIds = this.db
      .select({ spaceId: l3KeywordSpaces.spaceId })
      .from(l3KeywordSpaces)
      .where(eq(l3KeywordSpaces.keywordId, id))
      .orderBy(asc(l3KeywordSpaces.spaceId))
      .all()
      .map((item) => item.spaceId)
      .filter((spaceId) => readableSpaceIds.includes(spaceId));
    if (!relatedSpaceIds.length) return undefined;

    const sourceRows = this.db
      .select({
        id: l2Memories.id,
        ownerSpaceId: l2Memories.ownerSpaceId,
        visible: l2Memories.visible,
      })
      .from(l3KeywordL2Links)
      .innerJoin(l2Memories, eq(l2Memories.id, l3KeywordL2Links.l2Id))
      .where(eq(l3KeywordL2Links.keywordId, id))
      .orderBy(asc(l2Memories.id))
      .all();
    const linkedSpaces = sourceRows.length
      ? this.db
          .select({ l2Id: l2SpaceLinks.l2Id, spaceId: l2SpaceLinks.spaceId })
          .from(l2SpaceLinks)
          .where(
            inArray(
              l2SpaceLinks.l2Id,
              sourceRows.map((item) => item.id)
            )
          )
          .all()
      : [];
    const linkedByL2 = new Map<string, string[]>();
    for (const link of linkedSpaces) {
      const list = linkedByL2.get(link.l2Id) ?? [];
      list.push(link.spaceId);
      linkedByL2.set(link.l2Id, list);
    }
    const sourceL2Ids = sourceRows
      .filter(
        (source) =>
          source.visible === 1 &&
          (readableSpaceIds.includes(source.ownerSpaceId) ||
            (linkedByL2.get(source.id) ?? []).some((spaceId) => readableSpaceIds.includes(spaceId)))
      )
      .map((source) => source.id);
    if (!sourceL2Ids.length) return undefined;

    return {
      id: row.id,
      term: row.term,
      normalizedTerm: row.normalizedTerm,
      aliases: aliases(row.aliasesJson),
      kind: row.kind as L3KeywordKind,
      scopeKey: row.scopeKey,
      baseWeight: row.baseWeight,
      weight: row.weight,
      hitCount: row.hitCount,
      ...(row.lastHitAt === null ? {} : { lastHitAt: row.lastHitAt }),
      needsRefresh: row.needsRefresh === 1,
      state: 'active',
      expiresAt: row.expiresAt,
      relatedSpaceIds,
      sourceL2Ids,
      sourceComplete: sourceL2Ids.length === sourceRows.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private l2Scope(l2Id: string): string[] | undefined {
    const row = this.db
      .select({ ownerSpaceId: l2Memories.ownerSpaceId, visible: l2Memories.visible })
      .from(l2Memories)
      .where(eq(l2Memories.id, l2Id))
      .get();
    if (!row || row.visible !== 1) return undefined;
    const related = this.db
      .select({ spaceId: l2SpaceLinks.spaceId })
      .from(l2SpaceLinks)
      .where(eq(l2SpaceLinks.l2Id, l2Id))
      .all()
      .map((item) => item.spaceId);
    return [...new Set([row.ownerSpaceId, ...related])].sort();
  }

  upsertKeyword(input: L3KeywordInput): L3Keyword {
    const normalizedTerm = normalizeL3Term(input.term);
    let relatedSpaceIds = [...new Set(input.relatedSpaceIds)].sort();
    let sourceL2Ids = [...new Set(input.sourceL2Ids)].sort();
    let aliasList = [...new Set(input.aliases.map((item) => item.trim()).filter(Boolean))];
    if (
      !normalizedTerm ||
      !relatedSpaceIds.length ||
      !sourceL2Ids.length ||
      !Number.isSafeInteger(input.baseWeight) ||
      input.baseWeight < 1 ||
      input.baseWeight > 5
    )
      throw new MemoryError('INVALID_INPUT', 'Invalid L3 keyword input.');
    let scopeKey = l3ScopeKey(relatedSpaceIds);
    return this.db.transaction(
      (tx) => {
        let existing = tx
          .select({ id: l3Keywords.id })
          .from(l3Keywords)
          .where(
            and(eq(l3Keywords.scopeKey, scopeKey), eq(l3Keywords.normalizedTerm, normalizedTerm))
          )
          .get();
        if (!existing && input.mergeSources && input.id) {
          existing = tx
            .select({ id: l3Keywords.id })
            .from(l3Keywords)
            .where(eq(l3Keywords.id, input.id))
            .get();
        }
        const id = existing?.id ?? input.id ?? randomUUID();
        if (existing && input.mergeSources) {
          const currentSources = tx
            .select({ l2Id: l3KeywordL2Links.l2Id })
            .from(l3KeywordL2Links)
            .where(eq(l3KeywordL2Links.keywordId, id))
            .all()
            .map((item) => item.l2Id);
          sourceL2Ids = [...new Set([...currentSources, ...sourceL2Ids])].sort();
          const currentRow = tx.select().from(l3Keywords).where(eq(l3Keywords.id, id)).get();
          if (currentRow) {
            aliasList = [...new Set([...aliases(currentRow.aliasesJson), ...aliasList])];
            const scopes = sourceL2Ids.map((l2Id) => this.l2Scope(l2Id));
            if (scopes.some((scope) => scope === undefined))
              throw new MemoryError('L3_SCOPE_EMPTY', 'An L3 source scope is unavailable.');
            let intersection = new Set(scopes[0]);
            for (const scope of scopes.slice(1)) {
              const next = new Set(scope);
              intersection = new Set([...intersection].filter((spaceId) => next.has(spaceId)));
            }
            relatedSpaceIds = [...intersection].sort();
            if (!relatedSpaceIds.length)
              throw new MemoryError('L3_SCOPE_EMPTY', 'L3 keyword scope is empty.');
            scopeKey = l3ScopeKey(relatedSpaceIds);
          }
        }
        if (existing) {
          tx.update(l3Keywords)
            .set({
              term: input.term,
              aliasesJson: JSON.stringify(aliasList),
              kind: input.kind,
              scopeKey,
              baseWeight: input.baseWeight,
              weight: sql`max(${l3Keywords.weight}, ${input.baseWeight})`,
              needsRefresh: 0,
              state: 'active',
              expiresAt: input.expiresAt,
              updatedAt: input.now,
            })
            .where(eq(l3Keywords.id, id))
            .run();
        } else {
          tx.insert(l3Keywords)
            .values({
              id,
              term: input.term,
              normalizedTerm,
              aliasesJson: JSON.stringify(aliasList),
              kind: input.kind,
              scopeKey,
              baseWeight: input.baseWeight,
              weight: input.baseWeight,
              hitCount: 0,
              lastHitAt: null,
              needsRefresh: 0,
              state: 'active',
              expiresAt: input.expiresAt,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .run();
        }
        tx.delete(l3KeywordSpaces).where(eq(l3KeywordSpaces.keywordId, id)).run();
        tx.insert(l3KeywordSpaces)
          .values(relatedSpaceIds.map((spaceId) => ({ keywordId: id, spaceId })))
          .run();
        tx.delete(l3KeywordL2Links).where(eq(l3KeywordL2Links.keywordId, id)).run();
        tx.insert(l3KeywordL2Links)
          .values(sourceL2Ids.map((l2Id) => ({ keywordId: id, l2Id })))
          .run();
        const loaded = this.loadKeyword(id, relatedSpaceIds, input.now);
        if (!loaded) throw new MemoryError('INVALID_INPUT', 'L3 keyword sources are unavailable.');
        return loaded;
      },
      { behavior: 'immediate' }
    );
  }

  getKeyword(id: string, readableSpaceIds: readonly string[], now: string): L3Keyword | undefined {
    return this.loadKeyword(id, readableSpaceIds, now);
  }

  match(
    terms: readonly string[],
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    now: string,
    limit: number
  ): L3Keyword[] {
    if (!terms.length || !anchoredSpaceIds.length || !readableSpaceIds.length) return [];
    const ftsTerms = terms.filter((term) => [...term].length >= 3);
    if (ftsTerms.length) assertIndexHealthy(this.db);
    const exact = terms.map(
      (term) =>
        sql`(k.normalized_term = ${term} OR instr(lower(k.term), ${term}) > 0 OR instr(lower(k.aliases_json), ${term}) > 0)`
    );
    const fuzzy = ftsTerms.map(
      (term) =>
        sql`k.id IN (SELECT keyword_id FROM memory_l3_fts WHERE memory_l3_fts MATCH ${`"${term.replaceAll('"', '""')}"`})`
    );
    const rows = this.db.all<{ id: string }>(sql`
      SELECT k.id FROM memory_l3_keywords k
      WHERE k.state = 'active'
        AND k.expires_at > ${now}
        AND EXISTS (
          SELECT 1 FROM memory_l3_keyword_spaces s
          WHERE s.keyword_id = k.id AND s.space_id IN (${sql.join(
            anchoredSpaceIds.map((id) => sql`${id}`),
            sql`, `
          )})
        )
        AND (${sql.join([...exact, ...fuzzy], sql` OR `)})
      ORDER BY k.weight DESC, k.last_hit_at DESC, k.updated_at DESC, k.id ASC
      LIMIT ${limit}
    `);
    return rows
      .map((row) => this.loadKeyword(row.id, readableSpaceIds, now))
      .filter((keyword): keyword is L3Keyword => keyword !== undefined);
  }

  list(
    anchoredSpaceIds: readonly string[],
    readableSpaceIds: readonly string[],
    now: string,
    limit: number
  ): L3Keyword[] {
    if (!anchoredSpaceIds.length || !readableSpaceIds.length) return [];
    const rows = this.db.all<{ id: string }>(sql`
      SELECT k.id FROM memory_l3_keywords k
      WHERE k.state = 'active'
        AND k.expires_at > ${now}
        AND EXISTS (
          SELECT 1 FROM memory_l3_keyword_spaces s
          WHERE s.keyword_id = k.id AND s.space_id IN (${sql.join(
            anchoredSpaceIds.map((id) => sql`${id}`),
            sql`, `
          )})
        )
      ORDER BY k.weight DESC, k.last_hit_at DESC, k.updated_at DESC, k.id ASC
      LIMIT ${limit}
    `);
    return rows
      .map((row) => this.loadKeyword(row.id, readableSpaceIds, now))
      .filter((keyword): keyword is L3Keyword => keyword !== undefined);
  }

  private loadJob(row: typeof l3Jobs.$inferSelect): L3Job {
    return {
      id: row.id,
      state: row.state as L3Job['state'],
      ...(row.runId === null ? {} : { runId: row.runId }),
      ...(row.promptVersion === null ? {} : { promptVersion: row.promptVersion }),
      ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
      ...(row.errorMessage === null ? {} : { errorMessage: row.errorMessage }),
      createdAt: row.createdAt,
      ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
      ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
    };
  }

  private loadChange(row: typeof l3Changes.$inferSelect): L3Change {
    return {
      id: row.id,
      l2Id: row.l2Id,
      kind: row.kind as L3Change['kind'],
      l2Hash: row.l2Hash,
      state: row.state as L3Change['state'],
      ...(row.jobId === null ? {} : { jobId: row.jobId }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      createdAt: row.createdAt,
      ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
    };
  }

  listChanges(readableSpaceIds: readonly string[], limit: number): L3Change[] {
    if (!readableSpaceIds.length) return [];
    const rows = this.db.all<{ id: string }>(sql`
      SELECT c.id FROM memory_l3_changes c
      JOIN memory_l2 m ON m.id = c.l2_id
      WHERE m.owner_space_id IN (${sql.join(
        readableSpaceIds.map((id) => sql`${id}`),
        sql`, `
      )}) OR EXISTS (
        SELECT 1 FROM memory_l2_space_links s
        WHERE s.l2_id = m.id AND s.space_id IN (${sql.join(
          readableSpaceIds.map((id) => sql`${id}`),
          sql`, `
        )})
      )
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit}
    `);
    return rows
      .map((row) => this.db.select().from(l3Changes).where(eq(l3Changes.id, row.id)).get())
      .filter((row): row is typeof l3Changes.$inferSelect => row !== undefined)
      .map((row) => this.loadChange(row));
  }

  enqueueColdStart(readableSpaceIds: readonly string[], limit: number, now: string): number {
    if (!readableSpaceIds.length) return 0;
    return this.db.transaction(
      () => {
        const rows = this.db.all<{ id: string }>(sql`
          SELECT m.id FROM memory_l2 m
          WHERE m.visible = 1
            AND (
              m.owner_space_id IN (${sql.join(
                readableSpaceIds.map((id) => sql`${id}`),
                sql`, `
              )})
              OR EXISTS (
                SELECT 1 FROM memory_l2_space_links s
                WHERE s.l2_id = m.id AND s.space_id IN (${sql.join(
                  readableSpaceIds.map((id) => sql`${id}`),
                  sql`, `
                )})
              )
            )
          ORDER BY m.updated_at ASC, m.id ASC
          LIMIT ${limit}
        `);
        let count = 0;
        for (const row of rows) if (registerL3ChangeForL2(this.db, row.id, 'created', now)) count++;
        return count;
      },
      { behavior: 'immediate' }
    );
  }

  l2Hash(l2Id: string): string | undefined {
    return l2SnapshotHash(this.db, l2Id);
  }

  listRelatedKeywords(l2Ids: readonly string[], now: string, limit: number): L3Keyword[] {
    if (!l2Ids.length) return [];
    const rows = this.db.all<{ id: string }>(sql`
      SELECT DISTINCT k.id FROM memory_l3_keywords k
      JOIN memory_l3_keyword_l2_links link ON link.keyword_id = k.id
      WHERE link.l2_id IN (${sql.join(
        l2Ids.map((id) => sql`${id}`),
        sql`, `
      )})
        AND k.state = 'active'
        AND k.expires_at > ${now}
      ORDER BY k.weight DESC, k.updated_at DESC, k.id ASC
      LIMIT ${limit}
    `);
    const allSpaces = this.db
      .select({ id: spaces.id })
      .from(spaces)
      .all()
      .map((item) => item.id);
    return rows
      .map((row) => this.loadKeyword(row.id, allSpaces, now))
      .filter((keyword): keyword is L3Keyword => keyword !== undefined);
  }

  createJob(job: L3Job): L3Job {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(l3Jobs).where(eq(l3Jobs.id, job.id)).get();
      if (existing) return this.loadJob(existing);
      tx.insert(l3Jobs)
        .values({
          id: job.id,
          state: job.state,
          runId: job.runId ?? null,
          promptVersion: job.promptVersion ?? null,
          errorCode: job.errorCode ?? null,
          errorMessage: job.errorMessage ?? null,
          createdAt: job.createdAt,
          startedAt: job.startedAt ?? null,
          finishedAt: job.finishedAt ?? null,
        })
        .run();
      return this.loadJob(tx.select().from(l3Jobs).where(eq(l3Jobs.id, job.id)).get()!);
    });
  }

  getJob(id: string): L3Job | undefined {
    const row = this.db.select().from(l3Jobs).where(eq(l3Jobs.id, id)).get();
    return row ? this.loadJob(row) : undefined;
  }

  setPromptVersion(id: string, runId: string, version: string, now: string): void {
    const result = this.db
      .update(l3Jobs)
      .set({ promptVersion: version, startedAt: now })
      .where(and(eq(l3Jobs.id, id), eq(l3Jobs.state, 'running'), eq(l3Jobs.runId, runId)))
      .run();
    if (!result.changes)
      throw new MemoryError('JOB_NOT_PENDING', 'The L3 job is no longer running.');
  }

  claim(
    id: string,
    runId: string,
    now: string,
    batchSize: number
  ): { job: L3Job; changes: L3Change[] } | undefined {
    return this.db.transaction(
      (tx) => {
        const job = tx
          .select()
          .from(l3Jobs)
          .where(and(eq(l3Jobs.id, id), eq(l3Jobs.state, 'pending')))
          .get();
        if (!job) return undefined;
        const pending = tx
          .select()
          .from(l3Changes)
          .where(eq(l3Changes.state, 'pending'))
          .orderBy(asc(l3Changes.createdAt), asc(l3Changes.id))
          .limit(batchSize)
          .all();
        if (!pending.length) return undefined;
        tx.update(l3Jobs)
          .set({ state: 'running', runId, startedAt: now, errorCode: null, errorMessage: null })
          .where(and(eq(l3Jobs.id, id), eq(l3Jobs.state, 'pending')))
          .run();
        tx.update(l3Changes)
          .set({ state: 'claimed', jobId: id })
          .where(
            inArray(
              l3Changes.id,
              pending.map((row) => row.id)
            )
          )
          .run();
        return {
          job: this.loadJob(tx.select().from(l3Jobs).where(eq(l3Jobs.id, id)).get()!),
          changes: pending.map((row) => this.loadChange({ ...row, state: 'claimed', jobId: id })),
        };
      },
      { behavior: 'immediate' }
    );
  }

  finishChanges(
    ids: readonly string[],
    state: L3ChangeState,
    jobId: string,
    reason: string | undefined,
    now: string
  ): void {
    if (!ids.length) return;
    this.db
      .update(l3Changes)
      .set({ state, jobId, reason: reason ?? null, processedAt: now })
      .where(and(inArray(l3Changes.id, [...ids]), eq(l3Changes.jobId, jobId)))
      .run();
  }

  recordResult(
    jobId: string,
    resultIndex: number,
    state: L3ResultState,
    action: 'upsert',
    keywordId: string | undefined,
    l2Ids: readonly string[],
    errorCode: string | undefined,
    now: string
  ): void {
    this.db
      .insert(l3JobResults)
      .values({
        id: randomUUID(),
        jobId,
        resultIndex,
        state,
        action,
        keywordId: keywordId ?? null,
        l2IdsJson: JSON.stringify(l2Ids),
        errorCode: errorCode ?? null,
        errorMessage: null,
        createdAt: now,
      })
      .run();
  }

  finishJob(
    id: string,
    runId: string,
    state: 'succeeded' | 'partial' | 'failed' | 'unknown',
    errorCode: string | undefined,
    errorMessage: string | undefined,
    now: string
  ): void {
    const result = this.db
      .update(l3Jobs)
      .set({
        state,
        runId: null,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        finishedAt: now,
      })
      .where(and(eq(l3Jobs.id, id), eq(l3Jobs.state, 'running'), eq(l3Jobs.runId, runId)))
      .run();
    if (!result.changes)
      throw new MemoryError('JOB_NOT_PENDING', 'The L3 job is no longer running.');
  }

  retryJob(id: string, state: 'failed' | 'unknown' | 'partial', now: string): L3Job | undefined {
    return this.db.transaction((tx) => {
      const row = tx
        .update(l3Jobs)
        .set({
          state: 'pending',
          runId: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
        })
        .where(and(eq(l3Jobs.id, id), eq(l3Jobs.state, state)))
        .returning()
        .get();
      if (!row) return undefined;
      tx.delete(l3JobResults).where(eq(l3JobResults.jobId, id)).run();
      tx.update(l3Changes)
        .set({ state: 'pending', jobId: null, reason: null, processedAt: null })
        .where(and(eq(l3Changes.jobId, id), eq(l3Changes.state, 'failed')))
        .run();
      return this.loadJob(row);
    });
  }

  expireKeywords(now: string): number {
    const result = this.db
      .update(l3Keywords)
      .set({ state: 'expired', updatedAt: now })
      .where(and(eq(l3Keywords.state, 'active'), sql`${l3Keywords.expiresAt} <= ${now}`))
      .run();
    return result.changes;
  }

  cleanupExpired(cutoff: string): number {
    return this.db.transaction(
      (tx) => {
        const ids = tx
          .select({ id: l3Keywords.id })
          .from(l3Keywords)
          .where(and(eq(l3Keywords.state, 'expired'), sql`${l3Keywords.updatedAt} <= ${cutoff}`))
          .all()
          .map((row) => row.id);
        if (!ids.length) return 0;
        tx.update(l3JobResults)
          .set({ keywordId: null })
          .where(inArray(l3JobResults.keywordId, ids))
          .run();
        tx.delete(l3KeywordSpaces).where(inArray(l3KeywordSpaces.keywordId, ids)).run();
        tx.delete(l3KeywordL2Links).where(inArray(l3KeywordL2Links.keywordId, ids)).run();
        tx.delete(l3Keywords).where(inArray(l3Keywords.id, ids)).run();
        return ids.length;
      },
      { behavior: 'immediate' }
    );
  }

  recordHits(ids: readonly string[], now: string, expiresAt: string): void {
    if (!ids.length) return;
    this.db
      .update(l3Keywords)
      .set({
        hitCount: sql`${l3Keywords.hitCount} + 1`,
        weight: sql`min(50, ${l3Keywords.weight} + 1)`,
        lastHitAt: now,
        expiresAt,
      })
      .where(and(inArray(l3Keywords.id, [...ids]), eq(l3Keywords.state, 'active')))
      .run();
  }

  checkSearchIndex(): import('../../domain/memory/l3').L3IndexStatus {
    return this.db.transaction(() => indexStatus(this.db));
  }

  rebuildSearchIndex(): void {
    rebuildIndex(this.db);
  }
}
