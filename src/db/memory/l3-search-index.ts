import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MemoryError } from '../../domain/memory/types';
import type { L3IndexStatus } from '../../domain/memory/l3';

const tableSql = `CREATE VIRTUAL TABLE memory_l3_fts USING fts5(keyword_id UNINDEXED, term, aliases, tokenize='trigram')`;
const triggers: readonly [string, string, string][] = [
  [
    'memory_l3_fts_insert',
    'memory_l3_keywords',
    `CREATE TRIGGER memory_l3_fts_insert AFTER INSERT ON memory_l3_keywords BEGIN
  INSERT INTO memory_l3_fts(keyword_id, term, aliases)
  VALUES (NEW.id, NEW.term, NEW.aliases_json);
END`,
  ],
  [
    'memory_l3_fts_update',
    'memory_l3_keywords',
    `CREATE TRIGGER memory_l3_fts_update AFTER UPDATE OF term, aliases_json ON memory_l3_keywords BEGIN
  UPDATE memory_l3_fts SET term = NEW.term, aliases = NEW.aliases_json WHERE keyword_id = NEW.id;
END`,
  ],
  [
    'memory_l3_fts_delete',
    'memory_l3_keywords',
    `CREATE TRIGGER memory_l3_fts_delete AFTER DELETE ON memory_l3_keywords BEGIN
  DELETE FROM memory_l3_fts WHERE keyword_id = OLD.id;
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

export function indexStatus(db: BetterSQLite3Database): L3IndexStatus {
  const table = object(db, 'memory_l3_fts');
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
  db.get(sql`SELECT count(*) FROM memory_l3_fts`);
  const integrity = db.all<{ integrity_check: string }>(sql`PRAGMA integrity_check(memory_l3_fts)`);
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') return 'corrupt';
  const mismatch = db.get<{ mismatch: number }>(sql`
    WITH expected AS (
      SELECT id AS keyword_id, term, aliases_json AS aliases FROM memory_l3_keywords
    ), differences AS (
      SELECT * FROM (SELECT * FROM expected EXCEPT SELECT keyword_id, term, aliases FROM memory_l3_fts)
      UNION ALL
      SELECT * FROM (SELECT keyword_id, term, aliases FROM memory_l3_fts EXCEPT SELECT * FROM expected)
    )
    SELECT EXISTS(SELECT 1 FROM differences) OR EXISTS(
      SELECT 1 FROM memory_l3_fts GROUP BY keyword_id HAVING count(*) != 1
    ) AS mismatch
  `);
  return mismatch?.mismatch ? 'stale' : 'healthy';
}

export function assertIndexHealthy(db: BetterSQLite3Database): void {
  const status = indexStatus(db);
  if (status !== 'healthy') {
    const codes = {
      missing: 'L3_INDEX_MISSING',
      stale: 'L3_INDEX_STALE',
      corrupt: 'L3_INDEX_CORRUPT',
      unavailable: 'L3_INDEX_UNAVAILABLE',
    } as const;
    throw new MemoryError(codes[status], `L3 search index is ${status}.`);
  }
}

export function rebuildIndex(db: BetterSQLite3Database): void {
  db.transaction(
    () => {
      const table = object(db, 'memory_l3_fts');
      if (
        table &&
        (table.type !== 'table' ||
          !table.definition ||
          normalize(table.definition) !== normalize(tableSql))
      ) {
        throw new MemoryError(
          'L3_INDEX_UNAVAILABLE',
          'The L3 search index name is occupied by an unexpected object.'
        );
      }
      for (const [name, owner] of triggers) {
        const trigger = object(db, name);
        if (trigger && (trigger.type !== 'trigger' || trigger.tableName !== owner)) {
          throw new MemoryError(
            'L3_INDEX_UNAVAILABLE',
            'An L3 search trigger name is occupied by an unexpected object.'
          );
        }
      }
      for (const [name] of triggers) db.run(sql.raw(`DROP TRIGGER IF EXISTS "${name}"`));
      if (table) db.run(sql`DROP TABLE memory_l3_fts`);
      db.run(sql.raw(tableSql));
      db.run(sql`INSERT INTO memory_l3_fts(keyword_id, term, aliases)
        SELECT id, term, aliases_json FROM memory_l3_keywords`);
      for (const [, , definition] of triggers) db.run(sql.raw(definition));
      assertIndexHealthy(db);
    },
    { behavior: 'immediate' }
  );
}
