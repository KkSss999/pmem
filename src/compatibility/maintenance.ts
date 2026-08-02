/** Synchronous v1.2 maintenance adapter for legacy command workflows. */
import { closeDatabase, createSchema, openDatabase } from '../core/db';
import type Database from 'better-sqlite3';

export * from '../core/db';
export type MaintenanceDatabase = Database.Database;

export function openMaintenanceDatabase(pmemPath: string): MaintenanceDatabase {
  const db = openDatabase(pmemPath);
  createSchema(db);
  return db;
}
export function closeMaintenanceDatabase(db?: MaintenanceDatabase): void {
  closeDatabase(db);
}
