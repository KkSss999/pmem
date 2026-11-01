import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MemoryError } from '../../domain/memory/types';
import type { MaintenanceDecision, MaintenanceTask } from '../../domain/memory/l1-maintenance';
import type {
  L1MaintenanceRepository,
  MaintenanceSnapshot,
  PreparedMaintenance,
} from '../../service/memory/l1-maintenance-ports';
import { l1Cues, l1MaintenanceTasks, l1Memories, l1Sources, l1SpaceLinks } from './schema';
import { assertIndexHealthy } from './l1-search-index';
import { migrateL2LinksForMerge } from './l2-invalidation';

export class SqliteL1MaintenanceRepository implements L1MaintenanceRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  private scope(id: string, spaceId: string): string[] {
    const links = this.db
      .select({ value: l1SpaceLinks.spaceId })
      .from(l1SpaceLinks)
      .where(eq(l1SpaceLinks.memoryId, id))
      .all()
      .map((x) => x.value);
    return [...new Set([spaceId, ...links])].sort();
  }

  private snapshot(id: string): MaintenanceSnapshot | undefined {
    const row = this.db.select().from(l1Memories).where(eq(l1Memories.id, id)).get();
    if (!row) return undefined;
    const task = this.db
      .select({ sequence: l1MaintenanceTasks.sequence })
      .from(l1MaintenanceTasks)
      .where(eq(l1MaintenanceTasks.memoryId, id))
      .get();
    if (!task) throw new MemoryError('JOB_NOT_FOUND', 'Maintenance task is missing.');
    const cues = this.db
      .select({ value: l1Cues.cue })
      .from(l1Cues)
      .where(eq(l1Cues.memoryId, id))
      .orderBy(asc(l1Cues.cue))
      .all()
      .map((x) => x.value);
    const sourceIds = this.db
      .select({ value: l1Sources.l0Id })
      .from(l1Sources)
      .where(eq(l1Sources.memoryId, id))
      .orderBy(asc(l1Sources.l0Id))
      .all()
      .map((x) => x.value);
    return {
      id,
      spaceId: row.spaceId,
      content: row.content,
      abstraction: row.abstraction,
      cues,
      scope: this.scope(id, row.spaceId),
      sourceIds,
      jobIds: [],
      sequence: task.sequence,
      createdAt: row.createdAt,
    };
  }

  claim(allowed: readonly string[], token: string, now: string): string[] {
    if (!allowed.length) return [];
    return this.db.transaction(
      (tx) => {
        const running = tx
          .select({ id: l1MaintenanceTasks.memoryId, spaceId: l1Memories.spaceId })
          .from(l1MaintenanceTasks)
          .innerJoin(l1Memories, eq(l1Memories.id, l1MaintenanceTasks.memoryId))
          .where(inArray(l1MaintenanceTasks.state, ['running', 'failed', 'unknown']))
          .all();
        const busyScopes = new Set(
          running.map((row) => JSON.stringify(this.scope(row.id, row.spaceId)))
        );
        const rows = tx
          .select({ id: l1MaintenanceTasks.memoryId, spaceId: l1Memories.spaceId })
          .from(l1MaintenanceTasks)
          .innerJoin(l1Memories, eq(l1Memories.id, l1MaintenanceTasks.memoryId))
          .where(
            and(eq(l1MaintenanceTasks.state, 'pending'), inArray(l1Memories.spaceId, [...allowed]))
          )
          .orderBy(asc(l1MaintenanceTasks.sequence))
          .all();
        const selected = [];
        for (const row of rows) {
          if (!busyScopes.has(JSON.stringify(this.scope(row.id, row.spaceId)))) selected.push(row);
          if (selected.length === 5) break;
        }
        for (const row of selected)
          tx.update(l1MaintenanceTasks)
            .set({ state: 'running', claimToken: token, failureCode: null, updatedAt: now })
            .where(
              and(eq(l1MaintenanceTasks.memoryId, row.id), eq(l1MaintenanceTasks.state, 'pending'))
            )
            .run();
        return selected.map((row) => row.id);
      },
      { behavior: 'immediate' }
    );
  }

  claimStream(id: string, allowed: readonly string[], token: string, now: string): boolean {
    if (!allowed.length) return false;
    return this.db.transaction(
      (tx) => {
        const memory = tx
          .select({ spaceId: l1Memories.spaceId })
          .from(l1Memories)
          .where(eq(l1Memories.id, id))
          .get();
        if (!memory || !allowed.includes(memory.spaceId)) return false;
        const row = tx
          .update(l1MaintenanceTasks)
          .set({ state: 'running', claimToken: token, failureCode: null, updatedAt: now })
          .where(and(eq(l1MaintenanceTasks.memoryId, id), eq(l1MaintenanceTasks.state, 'pending')))
          .returning({ id: l1MaintenanceTasks.memoryId })
          .get();
        return !!row;
      },
      { behavior: 'immediate' }
    );
  }

  private candidates(
    source: MaintenanceSnapshot,
    allowed: readonly string[],
    token: string
  ): MaintenanceSnapshot[] {
    const input = [source.content, source.abstraction, ...source.cues].join(' ').slice(0, 2048);
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const terms = [
      ...new Set(
        [...segmenter.segment(input)]
          .filter((x) => x.isWordLike)
          .map((x) => x.segment.toLowerCase())
      ),
    ].slice(0, 32);
    if (!terms.length) return [];
    const matches = terms.map((term) =>
      [...term].length >= 3
        ? sql`m.id IN (SELECT memory_id FROM memory_l1_search WHERE memory_l1_search MATCH ${`"${term.replaceAll('"', '""')}"`})`
        : sql`EXISTS (SELECT 1 FROM memory_l1_search s WHERE s.memory_id = m.id AND (instr(lower(s.content), ${term}) > 0 OR instr(lower(s.abstraction), ${term}) > 0 OR instr(lower(s.cues), ${term}) > 0))`
    );
    const score = sql.join(
      matches.map((match) => sql`(CASE WHEN ${match} THEN 1 ELSE 0 END)`),
      sql` + `
    );
    const allowedSql = sql.join(
      allowed.map((id) => sql`${id}`),
      sql`, `
    );
    const scope = sql.join(
      source.scope.map((id) => sql`${id}`),
      sql`, `
    );
    const rows = this.db.all<{ id: string }>(sql`
      SELECT m.id FROM memory_l1 m
      JOIN memory_l1_maintenance_tasks candidate_task ON candidate_task.memory_id = m.id
      WHERE m.space_id IN (${allowedSql}) AND m.space_id IN (${scope})
        AND candidate_task.sequence < ${source.sequence}
        AND NOT EXISTS (SELECT 1 FROM memory_l1_space_links link WHERE link.memory_id = m.id AND link.space_id NOT IN (${scope}))
        AND (SELECT COUNT(DISTINCT link.space_id) FROM memory_l1_space_links link WHERE link.memory_id = m.id AND link.space_id != m.space_id) = ${source.scope.length - 1}
        AND NOT EXISTS (SELECT 1 FROM memory_l1_maintenance_tasks task WHERE task.memory_id = m.id AND task.state = 'running' AND task.claim_token != ${token})
        AND (${sql.join(matches, sql` OR `)})
      ORDER BY (${score}) DESC, candidate_task.sequence ASC LIMIT 5
    `);
    return rows.map((row) => this.snapshot(row.id)!).filter(Boolean);
  }

  prepare(
    ids: readonly string[],
    allowed: readonly string[],
    token: string
  ): PreparedMaintenance[] {
    return this.db.transaction(() => {
      assertIndexHealthy(this.db);
      return ids.map((id) => {
        const task = this.db
          .select()
          .from(l1MaintenanceTasks)
          .where(eq(l1MaintenanceTasks.memoryId, id))
          .get();
        const memory = this.snapshot(id);
        if (!task || task.state !== 'running' || task.claimToken !== token)
          throw new MemoryError('JOB_NOT_PENDING', 'Maintenance claim changed.');
        if (!memory || !allowed.includes(memory.spaceId))
          throw new MemoryError('ACCESS_DENIED', 'Maintenance memory is unavailable.');
        return { memory, candidates: this.candidates(memory, allowed, token) };
      });
    });
  }

  apply(
    cases: readonly PreparedMaintenance[],
    decisions: readonly MaintenanceDecision[],
    allowed: readonly string[],
    token: string,
    now: string
  ): void {
    this.db.transaction(
      (tx) => {
        for (const item of cases) {
          const task = tx
            .select()
            .from(l1MaintenanceTasks)
            .where(eq(l1MaintenanceTasks.memoryId, item.memory.id))
            .get();
          if (!task || task.state !== 'running' || task.claimToken !== token)
            throw new MemoryError('JOB_NOT_PENDING', 'Maintenance claim changed.');
          if (!allowed.includes(item.memory.spaceId))
            throw new MemoryError('ACCESS_DENIED', 'Maintenance access changed.');
        }
        for (const item of cases) {
          const id = item.memory.id;
          const decision = decisions.find((entry) => entry.memoryId === id)!;
          const current = this.snapshot(id);
          if (!current || JSON.stringify(current) !== JSON.stringify(item.memory))
            throw new MemoryError('SOURCE_CONFLICT', 'Maintenance memory changed.');
          const changed = item.candidates.some((candidate) => {
            const latest = this.snapshot(candidate.id);
            const task = tx
              .select()
              .from(l1MaintenanceTasks)
              .where(eq(l1MaintenanceTasks.memoryId, candidate.id))
              .get();
            return (
              !latest ||
              !allowed.includes(latest.spaceId) ||
              JSON.stringify(latest) !== JSON.stringify(candidate) ||
              (task?.state === 'running' && task.claimToken !== token)
            );
          });
          if (changed) {
            tx.update(l1MaintenanceTasks)
              .set({ state: 'pending', claimToken: null, updatedAt: now })
              .where(eq(l1MaintenanceTasks.memoryId, id))
              .run();
            continue;
          }
          if (decision.action === 'merge') {
            const target = item.candidates.find((candidate) => candidate.id === decision.targetId);
            if (
              !target ||
              !allowed.includes(target.spaceId) ||
              JSON.stringify(target.scope) !== JSON.stringify(current.scope)
            )
              throw new MemoryError('ACCESS_DENIED', 'Merge target is not eligible.');
            tx.update(l1Memories)
              .set({ content: decision.content, abstraction: decision.abstraction })
              .where(eq(l1Memories.id, target.id))
              .run();
            tx.delete(l1Cues).where(eq(l1Cues.memoryId, target.id)).run();
            if (decision.cues.length)
              tx.insert(l1Cues)
                .values(decision.cues.map((cue) => ({ memoryId: target.id, cue })))
                .onConflictDoNothing()
                .run();
            if (current.sourceIds.length)
              tx.insert(l1Sources)
                .values(current.sourceIds.map((l0Id) => ({ memoryId: target.id, l0Id })))
                .onConflictDoNothing()
                .run();
            tx.update(l1MaintenanceTasks)
              .set({ resultMemoryId: target.id })
              .where(eq(l1MaintenanceTasks.resultMemoryId, id))
              .run();
            tx.delete(l1Sources).where(eq(l1Sources.memoryId, id)).run();
            tx.delete(l1Cues).where(eq(l1Cues.memoryId, id)).run();
            tx.delete(l1SpaceLinks).where(eq(l1SpaceLinks.memoryId, id)).run();
            tx.delete(l1Memories).where(eq(l1Memories.id, id)).run();
            tx.update(l1MaintenanceTasks)
              .set({
                state: 'succeeded',
                claimToken: null,
                outcome: 'merge',
                resultMemoryId: target.id,
                updatedAt: now,
              })
              .where(eq(l1MaintenanceTasks.memoryId, id))
              .run();
            migrateL2LinksForMerge(tx, id, target.id, now);
          } else {
            tx.update(l1Memories)
              .set({ maintenanceStatus: 'complete' })
              .where(eq(l1Memories.id, id))
              .run();
            tx.update(l1MaintenanceTasks)
              .set({
                state: 'succeeded',
                claimToken: null,
                outcome: item.candidates.length ? decision.action : 'no_candidates',
                resultMemoryId: id,
                updatedAt: now,
              })
              .where(eq(l1MaintenanceTasks.memoryId, id))
              .run();
          }
        }
      },
      { behavior: 'immediate' }
    );
  }

  fail(
    ids: readonly string[],
    token: string,
    state: 'failed' | 'unknown',
    code: string,
    now: string
  ): void {
    this.db.transaction(
      (tx) => {
        for (const id of ids) {
          const task = tx
            .update(l1MaintenanceTasks)
            .set({ state, claimToken: null, failureCode: code, updatedAt: now })
            .where(
              and(
                eq(l1MaintenanceTasks.memoryId, id),
                eq(l1MaintenanceTasks.state, 'running'),
                eq(l1MaintenanceTasks.claimToken, token)
              )
            )
            .returning()
            .get();
          if (task)
            tx.update(l1Memories)
              .set({ maintenanceStatus: 'failed' })
              .where(eq(l1Memories.id, id))
              .run();
        }
      },
      { behavior: 'immediate' }
    );
  }

  release(ids: readonly string[], token: string, now: string): void {
    this.db.transaction(
      (tx) => {
        for (const id of ids) {
          tx.update(l1MaintenanceTasks)
            .set({ state: 'pending', claimToken: null, updatedAt: now })
            .where(
              and(
                eq(l1MaintenanceTasks.memoryId, id),
                eq(l1MaintenanceTasks.state, 'running'),
                eq(l1MaintenanceTasks.claimToken, token)
              )
            )
            .run();
        }
      },
      { behavior: 'immediate' }
    );
  }

  getTask(id: string, readable: readonly string[]): MaintenanceTask | undefined {
    if (!readable.length) return undefined;
    const row = this.db
      .select()
      .from(l1MaintenanceTasks)
      .where(
        and(eq(l1MaintenanceTasks.memoryId, id), inArray(l1MaintenanceTasks.spaceId, [...readable]))
      )
      .get();
    if (!row) return undefined;
    return {
      memoryId: id,
      spaceId: row.spaceId,
      state: row.state as MaintenanceTask['state'],
      ...(row.outcome ? { outcome: row.outcome } : {}),
      ...(row.resultMemoryId ? { resultMemoryId: row.resultMemoryId } : {}),
      ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    };
  }

  listTasks(
    spaceId: string,
    state: MaintenanceTask['state'] | undefined,
    afterId: string | undefined,
    limit: number
  ): import('../../domain/memory/l1-maintenance').MaintenanceTaskPage {
    const rows = this.db
      .select({ id: l1MaintenanceTasks.memoryId })
      .from(l1MaintenanceTasks)
      .where(
        and(
          eq(l1MaintenanceTasks.spaceId, spaceId),
          ...(state ? [eq(l1MaintenanceTasks.state, state)] : []),
          ...(afterId ? [gt(l1MaintenanceTasks.memoryId, afterId)] : [])
        )
      )
      .orderBy(asc(l1MaintenanceTasks.memoryId))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      tasks: page.map((row) => this.getTask(row.id, [spaceId])!),
      ...(rows.length > limit ? { nextId: page[page.length - 1].id } : {}),
    };
  }

  retry(id: string, allowed: readonly string[], now: string): void {
    this.transition(id, allowed, ['failed', 'unknown'], 'pending', null, now);
  }

  interrupt(id: string, allowed: readonly string[], now: string): void {
    this.transition(id, allowed, ['running'], 'unknown', 'INTERRUPTED', now);
  }

  private transition(
    id: string,
    allowed: readonly string[],
    states: readonly string[],
    state: 'pending' | 'unknown',
    code: string | null,
    now: string
  ): void {
    if (!allowed.length)
      throw new MemoryError('ACCESS_DENIED', 'Maintenance space is not writable.');
    this.db.transaction(
      (tx) => {
        const updated = tx
          .update(l1MaintenanceTasks)
          .set({ state, failureCode: code, claimToken: null, updatedAt: now })
          .where(
            and(
              eq(l1MaintenanceTasks.memoryId, id),
              inArray(l1MaintenanceTasks.spaceId, [...allowed]),
              inArray(l1MaintenanceTasks.state, [...states])
            )
          )
          .returning()
          .get();
        if (!updated)
          throw new MemoryError(
            'JOB_NOT_PENDING',
            'Maintenance task is not in the required state.'
          );
        tx.update(l1Memories)
          .set({ maintenanceStatus: state === 'pending' ? 'pending' : 'failed' })
          .where(eq(l1Memories.id, id))
          .run();
      },
      { behavior: 'immediate' }
    );
  }
}
