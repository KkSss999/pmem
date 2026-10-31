import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  L3ScheduleOptions,
  L3ScheduleRepository,
} from '../../service/memory/l3-scheduler-ports';

export class SqliteL3ScheduleRepository implements L3ScheduleRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  next(now: Date, options: L3ScheduleOptions): boolean {
    const blocked = this.db.get<{ blocked: number }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM memory_l3_jobs
        WHERE state IN ('pending', 'running', 'partial', 'failed', 'unknown')
      ) AS blocked
    `);
    if (blocked?.blocked) return false;
    const row = this.db.get<{ total: number; oldest: string; newest: string }>(sql`
      SELECT COUNT(*) AS total, MIN(created_at) AS oldest, MAX(created_at) AS newest
      FROM memory_l3_changes
      WHERE state = 'pending'
    `);
    if (!row || !row.total) return false;
    const oldest = Date.parse(row.oldest);
    const newest = Date.parse(row.newest);
    if (!Number.isFinite(oldest) || !Number.isFinite(newest))
      throw new Error('Invalid L3 scheduling time.');
    const age = now.getTime();
    return (
      row.total >= options.batchSize ||
      age - newest >= options.idleMs ||
      age - oldest >= options.maxWaitMs
    );
  }
}
