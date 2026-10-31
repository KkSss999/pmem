export interface L1ScheduleRepository {
  next(
    allowedSpaceIds: readonly string[],
    excludedJobIds: readonly string[],
    now: Date
  ): string | undefined;
}
