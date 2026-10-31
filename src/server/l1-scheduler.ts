import type { OwnedDatabase } from '../db/database';
import { SqliteL1ScheduleRepository } from '../db/memory/l1-schedule-repository';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import type { L1ExtractionModel } from '../domain/memory/l1';
import type { MemoryAccess } from '../domain/memory/types';
import { MemoryService } from '../service/memory';
import { L1Service } from '../service/memory/l1';
import { L1Scheduler } from '../service/memory/l1-scheduler';
import { L1MaintenanceService } from '../service/memory/l1-maintenance';
import { SqliteL1MaintenanceRepository } from '../db/memory/l1-maintenance-repository';
import type { L1MaintenanceModel } from '../domain/memory/l1-maintenance';

export function assembleL1Scheduler(
  database: OwnedDatabase,
  model: L1ExtractionModel,
  access: MemoryAccess
): L1Scheduler {
  return database.createAdapter((orm, readOnly) => {
    const memoryRepository = new SqliteMemoryRepository(orm);
    return new L1Scheduler(
      new SqliteL1ScheduleRepository(orm),
      new MemoryService(memoryRepository, readOnly),
      new L1Service(new SqliteL1Repository(orm), memoryRepository, readOnly),
      model,
      access,
      readOnly,
      typeof (model as Partial<L1MaintenanceModel>).review === 'function'
        ? {
            service: new L1MaintenanceService(new SqliteL1MaintenanceRepository(orm), readOnly),
            model: model as L1ExtractionModel & L1MaintenanceModel,
          }
        : undefined
    );
  });
}
