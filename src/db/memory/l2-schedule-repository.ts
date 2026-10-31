import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  L2ScheduleOptions,
  L2ScheduleRepository,
} from '../../service/memory/l2-scheduler-ports';

export class SqliteL2ScheduleRepository implements L2ScheduleRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  next(
    allowedSpaceIds: readonly string[],
    excludedOwnerSpaceIds: readonly string[],
    now: Date,
    options: L2ScheduleOptions
  ): string | undefined {
    if (!allowedSpaceIds.length) return undefined;
    const allowed = sql.join(
      allowedSpaceIds.map((id) => sql`${id}`),
      sql`, `
    );
    const excluded = excludedOwnerSpaceIds.length
      ? sql`AND c.owner_space_id NOT IN (${sql.join(
          excludedOwnerSpaceIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql``;
    const rows = this.db.all<{
      owner: string;
      total: number;
      oldest: string;
      newest: string;
    }>(sql`
      SELECT c.owner_space_id AS owner, COUNT(*) AS total,
             MIN(c.created_at) AS oldest, MAX(c.created_at) AS newest
      FROM memory_l2_changes c
      WHERE c.state = 'pending'
        AND c.owner_space_id IN (${allowed})
        ${excluded}
        AND NOT EXISTS (
          SELECT 1 FROM memory_l2_jobs j
          WHERE j.owner_space_id = c.owner_space_id
            AND j.state IN ('pending', 'running', 'partial', 'failed', 'unknown')
        )
      GROUP BY c.owner_space_id
      ORDER BY oldest ASC, owner ASC
    `);
    for (const row of rows) {
      const oldest = Date.parse(row.oldest);
      const newest = Date.parse(row.newest);
      if (!Number.isFinite(oldest) || !Number.isFinite(newest))
        throw new Error('Invalid L2 scheduling time.');
      const age = now.getTime();
      if (
        row.total >= options.batchSize ||
        age - newest >= options.idleMs ||
        age - oldest >= options.maxWaitMs
      )
        return row.owner;
    }
    return undefined;
  }
}
