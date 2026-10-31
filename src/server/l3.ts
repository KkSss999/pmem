import type { OwnedDatabase } from '../db/database';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteL2Repository } from '../db/memory/l2-repository';
import { SqliteL3Repository } from '../db/memory/l3-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import { L3Service, type L3ServiceOptions } from '../service/memory/l3';

export function assembleL3(database: OwnedDatabase, options?: L3ServiceOptions): L3Service {
  return database.createAdapter(
    (orm, readOnly) =>
      new L3Service(
        new SqliteL3Repository(orm),
        new SqliteL2Repository(orm),
        new SqliteL1Repository(orm),
        new SqliteMemoryRepository(orm),
        readOnly,
        options
      )
  );
}
