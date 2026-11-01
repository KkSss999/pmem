import type { OwnedDatabase } from '../db/database';
import { MemoryStreamRepository } from '../db/memory/stream-repository';
import { MemoryStreamSessionRepository } from '../db/memory/stream-session-repository';

export interface MemoryStreamStore {
  queue: MemoryStreamRepository;
  sessions: MemoryStreamSessionRepository;
}

/** Internal stream storage composition; the caller owns the database. */
export function assembleMemoryStream(database: OwnedDatabase): MemoryStreamStore {
  return database.createAdapter((orm) => ({
    queue: new MemoryStreamRepository(orm),
    sessions: new MemoryStreamSessionRepository(orm),
  }));
}
