import {
  OwnedDatabase,
  PmemError,
  type DatabaseStatus,
  type MigrationResult,
} from '../db/database';

export interface DatabasePathOptions {
  databasePath: string;
}

export interface OpenOptions extends DatabasePathOptions {
  readOnly?: boolean;
}

export interface MigrateOptions extends DatabasePathOptions {
  backupPath: string;
}

export class Pmem {
  private constructor(private readonly database: OwnedDatabase) {}

  static create(options: DatabasePathOptions): Pmem {
    return new Pmem(OwnedDatabase.create(options.databasePath));
  }

  static open(options: OpenOptions): Pmem {
    if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') {
      throw new PmemError('INVALID_OPTIONS', 'readOnly must be a boolean.');
    }
    return new Pmem(OwnedDatabase.open(options.databasePath, options.readOnly ?? false));
  }

  static migrate(options: MigrateOptions): Promise<MigrationResult> {
    return OwnedDatabase.migrate(options.databasePath, options.backupPath);
  }

  status(): DatabaseStatus {
    return this.database.status();
  }

  close(): void {
    this.database.close();
  }
}
