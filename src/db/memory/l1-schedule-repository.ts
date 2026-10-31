import { and, asc, eq, gt, inArray, notExists } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { L1ScheduleRepository } from '../../service/memory/l1-scheduler-ports';
import { l0Messages, l1AutoGroups, l1Jobs, l1JobSources } from './schema';

export class SqliteL1ScheduleRepository implements L1ScheduleRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  next(
    allowedSpaceIds: readonly string[],
    excludedJobIds: readonly string[],
    now: Date
  ): string | undefined {
    if (!allowedSpaceIds.length) return undefined;
    return this.db.transaction(
      (tx) => {
        const groups = tx
          .select()
          .from(l1AutoGroups)
          .where(inArray(l1AutoGroups.spaceId, [...allowedSpaceIds]))
          .orderBy(
            asc(l1AutoGroups.lastActivity),
            asc(l1AutoGroups.spaceId),
            asc(l1AutoGroups.source),
            asc(l1AutoGroups.sessionId)
          )
          .all();
        for (const group of groups) {
          const key = and(
            eq(l1AutoGroups.spaceId, group.spaceId),
            eq(l1AutoGroups.source, group.source),
            eq(l1AutoGroups.sessionId, group.sessionId)
          );
          if (group.activeJobId) {
            const job = tx
              .select({ state: l1Jobs.state })
              .from(l1Jobs)
              .where(eq(l1Jobs.id, group.activeJobId))
              .get();
            if (!job) throw new Error('Scheduled L1 job is missing.');
            if (job.state === 'pending' && !excludedJobIds.includes(group.activeJobId))
              return group.activeJobId;
            if (job.state !== 'succeeded') continue;
            tx.update(l1AutoGroups).set({ activeJobId: null }).where(key).run();
          }
          const alreadyScheduled = tx
            .select({ id: l1JobSources.l0Id })
            .from(l1JobSources)
            .where(eq(l1JobSources.l0Id, l0Messages.id));
          const rows = tx
            .select({ id: l0Messages.id, sequence: l0Messages.sequence })
            .from(l0Messages)
            .where(
              and(
                eq(l0Messages.spaceId, group.spaceId),
                eq(l0Messages.source, group.source),
                eq(l0Messages.sessionId, group.sessionId),
                gt(l0Messages.sequence, group.cursor),
                notExists(alreadyScheduled)
              )
            )
            .orderBy(asc(l0Messages.sequence))
            .limit(10)
            .all();
          const activity = Date.parse(group.lastActivity);
          if (!Number.isFinite(activity)) throw new Error('Invalid L1 scheduling activity time.');
          if (!rows.length || (rows.length < 10 && now.getTime() - activity < 600_000)) continue;
          const id = randomUUID();
          const timestamp = now.toISOString();
          tx.insert(l1Jobs)
            .values({
              id,
              spaceId: group.spaceId,
              state: 'pending',
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
          tx.insert(l1JobSources)
            .values(rows.map((row) => ({ jobId: id, l0Id: row.id })))
            .run();
          tx.update(l1AutoGroups)
            .set({ cursor: rows[rows.length - 1].sequence, activeJobId: id })
            .where(key)
            .run();
          return id;
        }
        return undefined;
      },
      { behavior: 'immediate' }
    );
  }
}
