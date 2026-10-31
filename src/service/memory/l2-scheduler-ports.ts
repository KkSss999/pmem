export interface L2ScheduleOptions {
  batchSize: number;
  idleMs: number;
  maxWaitMs: number;
}

export interface L2ScheduleRepository {
  next(
    allowedSpaceIds: readonly string[],
    excludedOwnerSpaceIds: readonly string[],
    now: Date,
    options: L2ScheduleOptions
  ): string | undefined;
}
