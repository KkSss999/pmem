import Database from 'better-sqlite3';
import { getTableName } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { readMigrations, type MigrationSet } from './migrations';

const APPLICATION_ID = 0x504d454d;

export type DatabaseErrorCode =
  | 'INVALID_OPTIONS'
  | 'INVALID_PATH'
  | 'UNKNOWN_DATABASE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_JOURNAL_MODE'
  | 'MIGRATION_REQUIRED'
  | 'INVALID_MIGRATIONS'
  | 'FOREIGN_KEY_VIOLATION'
  | 'POST_COMMIT_CONFIGURATION_FAILED'
  | 'CLOSED';

export class PmemError extends Error {
  constructor(
    readonly code: DatabaseErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PmemError';
  }
}

function filePath(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value === ':memory:' ||
    value.startsWith('file:')
  ) {
    throw new PmemError('INVALID_PATH', 'A filesystem database path is required.');
  }
  return resolve(value);
}

function assertReadOnlySafe(path: string): void {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    const length = readSync(fd, header, 0, header.length, 0);
    if (
      length === header.length &&
      header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) &&
      (header[18] === 2 || header[19] === 2)
    ) {
      throw new PmemError(
        'UNSUPPORTED_JOURNAL_MODE',
        'WAL databases cannot be opened without risking SQLite sidecar writes.'
      );
    }
  } finally {
    closeSync(fd);
  }
}

function migrationFiles(): MigrationSet[] {
  try {
    return readMigrations();
  } catch (cause) {
    throw new PmemError('INVALID_MIGRATIONS', 'Cannot read the migration files.', { cause });
  }
}

function migrationVersions(
  db: Database.Database,
  sets: MigrationSet[],
  allowPending: boolean
): number[] {
  if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) {
    throw new PmemError('UNKNOWN_DATABASE', 'The file is not a PMEM foundation database.');
  }
  return sets.map(({ owner, files }) => {
    const tableName = getTableName(owner.table);
    const table = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    if (!table && owner.required) {
      throw new PmemError('UNKNOWN_DATABASE', 'The PMEM migration history is unavailable.');
    }
    const rows = table
      ? (db.prepare(`SELECT id, hash FROM "${tableName}" ORDER BY id`).all() as {
          id: number;
          hash: string;
        }[])
      : [];
    if (rows.length > files.length) {
      throw new PmemError(
        'UNSUPPORTED_VERSION',
        `The ${owner.name} database version is newer than this SDK.`
      );
    }
    if (
      (owner.required && !rows.length) ||
      rows.some((row, index) => row.id !== index + 1 || row.hash !== files[index].hash)
    ) {
      throw new PmemError('INVALID_MIGRATIONS', `Invalid ${owner.name} migration history.`);
    }
    if (!allowPending && rows.length !== files.length) {
      throw new PmemError(
        'MIGRATION_REQUIRED',
        `The ${owner.name} database requires an explicit migration.`
      );
    }
    return rows.length;
  });
}

function applyMigrations(db: Database.Database, sets: MigrationSet[], versions: number[]): void {
  const orm = drizzle(db);
  for (const [ownerIndex, { owner, files }] of sets.entries()) {
    const start = versions[ownerIndex];
    if (start < files.length && !owner.required) {
      const name = getTableName(owner.table);
      db.exec(
        `CREATE TABLE IF NOT EXISTS "${name}" (id INTEGER PRIMARY KEY NOT NULL, hash TEXT NOT NULL, applied_at TEXT NOT NULL)`
      );
    }
    for (let index = start; index < files.length; index += 1) {
      for (const statement of files[index].sql) db.exec(statement);
      orm
        .insert(owner.table)
        .values({
          id: index + 1,
          hash: files[index].hash,
          appliedAt: new Date().toISOString(),
        })
        .run();
    }
  }
}

function beginMigration(db: Database.Database): void {
  // SQLite ignores changes to foreign_keys inside a transaction.
  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
}

function commitMigration(db: Database.Database): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length) {
    throw new PmemError(
      'FOREIGN_KEY_VIOLATION',
      `Migration left ${violations.length} foreign key violation(s).`
    );
  }
  db.exec('COMMIT');
}

function rollback(db: Database.Database, cause: unknown): never {
  try {
    if (db.inTransaction) db.exec('ROLLBACK');
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      'Database operation and rollback both failed.'
    );
  }
  throw cause;
}

export class OwnedDatabase {
  private closed = false;

  private constructor(
    private readonly db: Database.Database,
    readonly readOnly: boolean
  ) {}

  static create(databasePath: string): OwnedDatabase {
    const target = filePath(databasePath);
    const files = migrationFiles();
    closeSync(openSync(target, 'wx', 0o600));
    const db = new Database(target, { fileMustExist: true });
    try {
      beginMigration(db);
      db.pragma(`application_id = ${APPLICATION_ID}`);
      applyMigrations(
        db,
        files,
        files.map(() => 0)
      );
      commitMigration(db);
      try {
        db.pragma('foreign_keys = ON');
      } catch (cause) {
        throw new PmemError(
          'POST_COMMIT_CONFIGURATION_FAILED',
          'Database creation committed, but connection configuration failed.',
          { cause }
        );
      }
      return new OwnedDatabase(db, false);
    } catch (cause) {
      try {
        rollback(db, cause);
      } finally {
        db.close();
      }
    }
  }

  static open(databasePath: string, readOnly: boolean): OwnedDatabase {
    const target = filePath(databasePath);
    const files = migrationFiles();
    assertReadOnlySafe(target);
    const inspection = new Database(target, { readonly: true, fileMustExist: true });
    try {
      migrationVersions(inspection, files, false);
      if (readOnly) {
        inspection.pragma('foreign_keys = ON');
        return new OwnedDatabase(inspection, true);
      }
    } catch (cause) {
      inspection.close();
      throw cause;
    }
    inspection.close();
    const db = new Database(target, { fileMustExist: true });
    try {
      migrationVersions(db, files, false);
      db.pragma('foreign_keys = ON');
      return new OwnedDatabase(db, false);
    } catch (cause) {
      db.close();
      throw cause;
    }
  }

  static async migrate(databasePath: string, backupPath: string): Promise<MigrationResult> {
    const target = filePath(databasePath);
    const backup = filePath(backupPath);
    const files = migrationFiles();
    // Identify the file before taking a write lock.
    assertReadOnlySafe(target);
    const inspection = new Database(target, { readonly: true, fileMustExist: true });
    try {
      migrationVersions(inspection, files, true);
    } finally {
      inspection.close();
    }
    const db = new Database(target, { fileMustExist: true });
    try {
      beginMigration(db);
      const current = migrationVersions(db, files, true);
      const pending = files.reduce(
        (total, set, index) => total + set.files.length - current[index],
        0
      );
      if (!pending) {
        db.exec('ROLLBACK');
        return { migrationsApplied: 0 };
      }
      // Hold the write lock while a separate reader takes the consistent snapshot.
      closeSync(openSync(backup, 'wx', 0o600));
      const reader = new Database(target, { readonly: true, fileMustExist: true });
      try {
        await reader.backup(backup);
      } finally {
        reader.close();
      }
      applyMigrations(db, files, current);
      commitMigration(db);
      return { migrationsApplied: pending, backupPath: backup };
    } catch (cause) {
      return rollback(db, cause);
    } finally {
      db.close();
    }
  }

  status(): DatabaseStatus {
    if (this.closed) throw new PmemError('CLOSED', 'The PMEM runtime is closed.');
    return {
      readOnly: this.readOnly,
      schemaVersion: migrationVersions(this.db, migrationFiles(), false).reduce(
        (sum, version) => sum + version,
        0
      ),
    };
  }

  createAdapter<T>(factory: (database: BetterSQLite3Database, readOnly: boolean) => T): T {
    if (this.closed) throw new PmemError('CLOSED', 'The PMEM runtime is closed.');
    return factory(drizzle(this.db), this.readOnly);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}

export interface DatabaseStatus {
  readOnly: boolean;
  schemaVersion: number;
}

export interface MigrationResult {
  migrationsApplied: number;
  backupPath?: string;
}
