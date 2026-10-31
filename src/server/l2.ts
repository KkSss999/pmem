import type { OwnedDatabase } from '../db/database';
import { SqliteL1Repository } from '../db/memory/l1-repository';
import { SqliteL2Repository } from '../db/memory/l2-repository';
import { SqliteMemoryRepository } from '../db/memory/repository';
import { L2Service, type L2ServiceOptions } from '../service/memory/l2';

export function assembleL2(database: OwnedDatabase, options?: L2ServiceOptions): L2Service {
  return database.createAdapter(
    (orm, readOnly) =>
      new L2Service(
        new SqliteL2Repository(orm),
        new SqliteL1Repository(orm),
        new SqliteMemoryRepository(orm),
        readOnly,
        options
      )
  );
}
