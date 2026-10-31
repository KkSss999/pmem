import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MemoryError } from '../../domain/memory/types';
import type { L1IndexStatus } from '../../domain/memory/l1';

const tableSql = `CREATE VIRTUAL TABLE memory_l1_search USING fts5(memory_id UNINDEXED, content, abstraction, cues, tokenize='trigram')`;
const triggers: readonly [string, string, string][] = [
  [
    'memory_l1_search_insert',
    'memory_l1',
    `CREATE TRIGGER memory_l1_search_insert AFTER INSERT ON memory_l1 BEGIN
  INSERT INTO memory_l1_search(memory_id, content, abstraction, cues)
  VALUES (NEW.id, NEW.content, NEW.abstraction, '');
END`,
  ],
  [
    'memory_l1_search_update',
    'memory_l1',
    `CREATE TRIGGER memory_l1_search_update AFTER UPDATE OF content, abstraction ON memory_l1 BEGIN
  UPDATE memory_l1_search SET content = NEW.content, abstraction = NEW.abstraction WHERE memory_id = NEW.id;
END`,
  ],
  [
    'memory_l1_search_delete',
    'memory_l1',
    `CREATE TRIGGER memory_l1_search_delete AFTER DELETE ON memory_l1 BEGIN
  DELETE FROM memory_l1_search WHERE memory_id = OLD.id;
END`,
  ],
  [
    'memory_l1_search_cue_insert',
    'memory_l1_cues',
    `CREATE TRIGGER memory_l1_search_cue_insert AFTER INSERT ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END`,
  ],
  [
    'memory_l1_search_cue_delete',
    'memory_l1_cues',
    `CREATE TRIGGER memory_l1_search_cue_delete AFTER DELETE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
END`,
  ],
  [
    'memory_l1_search_cue_update',
    'memory_l1_cues',
    `CREATE TRIGGER memory_l1_search_cue_update AFTER UPDATE ON memory_l1_cues BEGIN
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = OLD.memory_id), '') WHERE memory_id = OLD.memory_id;
  UPDATE memory_l1_search SET cues = COALESCE((SELECT group_concat(cue, ' ') FROM memory_l1_cues WHERE memory_id = NEW.memory_id), '') WHERE memory_id = NEW.memory_id;
END`,
  ],
];
const normalize = (text: string) => text.trim().replace(/;$/, '');

function object(
  db: BetterSQLite3Database,
  name: string
): { type: string; tableName: string; definition: string | null } | undefined {
  return db.get(
    sql`SELECT type, tbl_name AS tableName, sql AS definition FROM sqlite_schema WHERE name = ${name}`
  );
}

export function indexStatus(db: BetterSQLite3Database): L1IndexStatus {
  const table = object(db, 'memory_l1_search');
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
  // Open an FTS cursor first so its connection cache observes commits from other connections.
  db.get(sql`SELECT count(*) FROM memory_l1_search`);
  const integrity = db.all<{ integrity_check: string }>(
    sql`PRAGMA integrity_check(memory_l1_search)`
  );
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') return 'corrupt';
  const mismatch = db.get<{ mismatch: number }>(sql`
    WITH expected AS (
      SELECT m.id AS memory_id, m.content, m.abstraction,
        COALESCE((SELECT group_concat(c.cue, ' ') FROM memory_l1_cues c WHERE c.memory_id = m.id), '') AS cues
      FROM memory_l1 m
    ), differences AS (
      SELECT * FROM (SELECT * FROM expected EXCEPT SELECT memory_id, content, abstraction, cues FROM memory_l1_search)
      UNION ALL
      SELECT * FROM (SELECT memory_id, content, abstraction, cues FROM memory_l1_search EXCEPT SELECT * FROM expected)
    )
    SELECT EXISTS(SELECT 1 FROM differences) OR EXISTS(
      SELECT 1 FROM memory_l1_search GROUP BY memory_id HAVING count(*) != 1
    ) AS mismatch
  `);
  return mismatch?.mismatch ? 'stale' : 'healthy';
}

export function assertIndexHealthy(db: BetterSQLite3Database): void {
  const status = indexStatus(db);
  if (status !== 'healthy') {
    const codes = {
      missing: 'INDEX_MISSING',
      stale: 'INDEX_STALE',
      corrupt: 'INDEX_CORRUPT',
      unavailable: 'INDEX_UNAVAILABLE',
    } as const;
    throw new MemoryError(codes[status], `L1 search index is ${status}.`);
  }
}

export function rebuildIndex(db: BetterSQLite3Database): void {
  db.transaction(
    () => {
      const table = object(db, 'memory_l1_search');
      if (
        table &&
        (table.type !== 'table' ||
          !table.definition ||
          normalize(table.definition) !== normalize(tableSql))
      ) {
        throw new MemoryError(
          'INDEX_UNAVAILABLE',
          'The search index name is occupied by an unexpected object.'
        );
      }
      for (const [name, owner] of triggers) {
        const trigger = object(db, name);
        if (trigger && (trigger.type !== 'trigger' || trigger.tableName !== owner)) {
          throw new MemoryError(
            'INDEX_UNAVAILABLE',
            'A search trigger name is occupied by an unexpected object.'
          );
        }
      }
      for (const [name] of triggers) db.run(sql.raw(`DROP TRIGGER IF EXISTS "${name}"`));
      if (table) db.run(sql`DROP TABLE memory_l1_search`);
      db.run(sql.raw(tableSql));
      db.run(sql`INSERT INTO memory_l1_search(memory_id, content, abstraction, cues)
      SELECT m.id, m.content, m.abstraction,
        COALESCE((SELECT group_concat(c.cue, ' ') FROM memory_l1_cues c WHERE c.memory_id = m.id), '')
      FROM memory_l1 m`);
      for (const [, , definition] of triggers) db.run(sql.raw(definition));
      assertIndexHealthy(db);
    },
    { behavior: 'immediate' }
  );
}
