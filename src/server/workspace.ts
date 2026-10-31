import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { OwnedDatabase, type MigrationResult } from '../db/database';

export function defaultWorkspaceRoot(): string {
  return join(homedir(), '.pmem');
}

function databasePath(root: string): string {
  if (typeof root !== 'string' || !root.trim())
    throw new TypeError('A workspace directory is required.');
  return join(resolve(root), 'pmem.sqlite');
}

/** Creates a new workspace database; existing files are never overwritten. */
export function createWorkspace(root = defaultWorkspaceRoot()): OwnedDatabase {
  const path = databasePath(root);
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
  return OwnedDatabase.create(path);
}

/** Opens an existing workspace without creating a directory or migrating. */
export function openWorkspace(root = defaultWorkspaceRoot(), readOnly = false): OwnedDatabase {
  if (typeof readOnly !== 'boolean') throw new TypeError('readOnly must be a boolean.');
  return OwnedDatabase.open(databasePath(root), readOnly);
}

export function migrateWorkspace(
  backupPath: string,
  root = defaultWorkspaceRoot()
): Promise<MigrationResult> {
  return OwnedDatabase.migrate(databasePath(root), backupPath);
}
