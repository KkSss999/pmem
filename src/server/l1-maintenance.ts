import type { OwnedDatabase } from '../db/database';
import { SqliteL1MaintenanceRepository } from '../db/memory/l1-maintenance-repository';
import { L1MaintenanceService } from '../service/memory/l1-maintenance';

export function assembleL1Maintenance(database: OwnedDatabase): L1MaintenanceService {
  return database.createAdapter(
    (orm, readOnly) => new L1MaintenanceService(new SqliteL1MaintenanceRepository(orm), readOnly)
  );
}
