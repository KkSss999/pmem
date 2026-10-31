import type { OwnedDatabase } from '../db/database';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteL2Repository } from '../db/memory/l2-repository';
import { SqliteL3Repository } from '../db/memory/l3-repository';
import { SqliteL3ScheduleRepository } from '../db/memory/l3-schedule-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import type { L3GenerationModel } from '../domain/memory/l3';
import type { MemoryAccess } from '../domain/memory/types';
import { L3Service } from '../service/memory/l3';
import { L3Scheduler, type L3SchedulerOptions } from '../service/memory/l3-scheduler';

export function assembleL3Scheduler(
  database: OwnedDatabase,
  model: L3GenerationModel,
  access: MemoryAccess,
  options?: L3SchedulerOptions
): L3Scheduler {
  return database.createAdapter((orm, readOnly) => {
    const memory = new SqliteMemoryRepository(orm);
    return new L3Scheduler(
      new SqliteL3ScheduleRepository(orm),
      new L3Service(
        new SqliteL3Repository(orm),
        new SqliteL2Repository(orm),
        new SqliteL1Repository(orm),
        memory,
        readOnly
      ),
      model,
      access,
      readOnly,
      options
    );
  });
}
