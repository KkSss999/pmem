import type { OwnedDatabase } from '../db/database';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import { L1Service } from '../service/memory/l1';

export function assembleL1(database: OwnedDatabase): L1Service {
  return database.createAdapter(
    (orm, readOnly) =>
      new L1Service(new SqliteL1Repository(orm), new SqliteMemoryRepository(orm), readOnly)
  );
}
