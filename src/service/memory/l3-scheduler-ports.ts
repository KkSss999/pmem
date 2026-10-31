export interface L3ScheduleOptions {
  batchSize: number;
  idleMs: number;
  maxWaitMs: number;
}

export interface L3ScheduleRepository {
  next(now: Date, options: L3ScheduleOptions): boolean;
}
