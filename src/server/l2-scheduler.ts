import type { OwnedDatabase } from '../db/database';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteL2Repository } from '../db/memory/l2-repository';
import { SqliteL2ScheduleRepository } from '../db/memory/l2-schedule-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import type { L2GenerationModel } from '../domain/memory/l2';
import type { MemoryAccess } from '../domain/memory/types';
import { L2Service } from '../service/memory/l2';
import { L2Scheduler, type L2SchedulerOptions } from '../service/memory/l2-scheduler';

export function assembleL2Scheduler(
  database: OwnedDatabase,
  model: L2GenerationModel,
  access: MemoryAccess,
  options?: L2SchedulerOptions
): L2Scheduler {
  return database.createAdapter((orm, readOnly) => {
    const memory = new SqliteMemoryRepository(orm);
    return new L2Scheduler(
      new SqliteL2ScheduleRepository(orm),
      new L2Service(new SqliteL2Repository(orm), new SqliteL1Repository(orm), memory, readOnly),
      model,
      access,
      readOnly,
      options
    );
  });
}
