import type { OwnedDatabase } from '../db/database';
import { SqliteMemoryRepository } from '../db/memory/repository';
import { MemoryService } from '../service/memory';

/** Internal composition boundary. The caller owns and closes the database. */
export function assembleMemory(database: OwnedDatabase): MemoryService {
  return database.createAdapter(
    (orm, readOnly) => new MemoryService(new SqliteMemoryRepository(orm), readOnly)
  );
}
