import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MemoryError } from '../../domain/memory/types';
import type { L2IndexStatus } from '../../domain/memory/l2';

const tableSql = `CREATE VIRTUAL TABLE memory_l2_search USING fts5(l2_id UNINDEXED, title, summary, body, tokenize='trigram')`;
const triggers: readonly [string, string, string][] = [
  [
    'memory_l2_search_insert',
    'memory_l2',
    `CREATE TRIGGER memory_l2_search_insert AFTER INSERT ON memory_l2 BEGIN
  INSERT INTO memory_l2_search(l2_id, title, summary, body)
  VALUES (NEW.id, NEW.title, NEW.summary, NEW.body);
END`,
  ],
  [
    'memory_l2_search_update',
    'memory_l2',
    `CREATE TRIGGER memory_l2_search_update AFTER UPDATE OF title, summary, body ON memory_l2 BEGIN
  UPDATE memory_l2_search SET title = NEW.title, summary = NEW.summary, body = NEW.body WHERE l2_id = NEW.id;
END`,
  ],
  [
    'memory_l2_search_delete',
    'memory_l2',
    `CREATE TRIGGER memory_l2_search_delete AFTER DELETE ON memory_l2 BEGIN
  DELETE FROM memory_l2_search WHERE l2_id = OLD.id;
END`,
  ],
];
const normalize = (value: string) => value.trim().replace(/;$/, '');

function object(
  db: BetterSQLite3Database,
  name: string
): { type: string; tableName: string; definition: string | null } | undefined {
  return db.get(
    sql`SELECT type, tbl_name AS tableName, sql AS definition FROM sqlite_schema WHERE name = ${name}`
  );
}

export function indexStatus(db: BetterSQLite3Database): L2IndexStatus {
  const table = object(db, 'memory_l2_search');
  if (!table) return 'missing';
  if (
    table.type !== 'table' ||
    !table.definition ||
    normalize(table.definition) !== normalize(tableSql)
  )
    return 'unavailable';
  for (const [name, owner, definition] of triggers) {
    const trigger = object(db, name);
    if (
      !trigger ||
      trigger.type !== 'trigger' ||
      trigger.tableName !== owner ||
      !trigger.definition ||
      normalize(trigger.definition) !== normalize(definition)
    )
      return 'stale';
  }
  const version = db
    .get<{ version: string }>(sql`SELECT sqlite_version() AS version`)!
    .version.split('.')
    .map(Number);
  if (version[0] < 3 || (version[0] === 3 && version[1] < 44)) return 'unavailable';
  db.get(sql`SELECT count(*) FROM memory_l2_search`);
  const integrity = db.all<{ integrity_check: string }>(
    sql`PRAGMA integrity_check(memory_l2_search)`
  );
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') return 'corrupt';
  const mismatch = db.get<{ mismatch: number }>(sql`
    WITH expected AS (
      SELECT id AS l2_id, title, summary, body FROM memory_l2
    ), differences AS (
      SELECT * FROM (SELECT * FROM expected EXCEPT SELECT l2_id, title, summary, body FROM memory_l2_search)
      UNION ALL
      SELECT * FROM (SELECT l2_id, title, summary, body FROM memory_l2_search EXCEPT SELECT * FROM expected)
    )
    SELECT EXISTS(SELECT 1 FROM differences) OR EXISTS(
      SELECT 1 FROM memory_l2_search GROUP BY l2_id HAVING count(*) != 1
    ) AS mismatch
  `);
  return mismatch?.mismatch ? 'stale' : 'healthy';
}

export function assertIndexHealthy(db: BetterSQLite3Database): void {
  const status = indexStatus(db);
  if (status !== 'healthy') {
    const codes = {
      missing: 'L2_INDEX_MISSING',
      stale: 'L2_INDEX_STALE',
      corrupt: 'L2_INDEX_CORRUPT',
      unavailable: 'L2_INDEX_UNAVAILABLE',
    } as const;
    throw new MemoryError(codes[status], `L2 search index is ${status}.`);
  }
}

export function rebuildIndex(db: BetterSQLite3Database): void {
  db.transaction(
    () => {
      const table = object(db, 'memory_l2_search');
      if (
        table &&
        (table.type !== 'table' ||
          !table.definition ||
          normalize(table.definition) !== normalize(tableSql))
      ) {
        throw new MemoryError(
          'L2_INDEX_UNAVAILABLE',
          'The L2 search index name is occupied by an unexpected object.'
        );
      }
      for (const [name, owner] of triggers) {
        const trigger = object(db, name);
        if (trigger && (trigger.type !== 'trigger' || trigger.tableName !== owner)) {
          throw new MemoryError(
            'L2_INDEX_UNAVAILABLE',
            'An L2 search trigger name is occupied by an unexpected object.'
          );
        }
      }
      for (const [name] of triggers) db.run(sql.raw(`DROP TRIGGER IF EXISTS "${name}"`));
      if (table) db.run(sql`DROP TABLE memory_l2_search`);
      db.run(sql.raw(tableSql));
      db.run(sql`INSERT INTO memory_l2_search(l2_id, title, summary, body)
        SELECT id, title, summary, body FROM memory_l2`);
      for (const [, , definition] of triggers) db.run(sql.raw(definition));
      assertIndexHealthy(db);
    },
    { behavior: 'immediate' }
  );
}
