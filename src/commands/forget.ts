import * as path from 'path';
import { fileExists } from '../core/fs';
import { openDatabase, createSchema, closeDatabase, forgetMemory, getActiveSession } from '../core/db';
import { getCurrentBranch } from '../core/git';

export function forgetCommand(memoryId: string, options: { reason?: string; confirm?: boolean } = {}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }
  if (!memoryId || !/^[a-z][a-z0-9._-]+$/.test(memoryId)) {
    console.error('Error: memoryId must be a valid pmem card id.');
    process.exit(2);
  }
  if (!options.confirm) {
    console.log(`Forget is a durable tombstone operation for ${memoryId}. Re-run with --confirm to apply.`);
    return;
  }

  try {
    const db = openDatabase(pmemPath);
    createSchema(db);
    const activeSession = getActiveSession(db);
    const result = forgetMemory(db, memoryId, {
      reason: options.reason,
      branch: getCurrentBranch(cwd),
      sessionId: activeSession?.id,
    });
    closeDatabase();

    if (!result.success) {
      console.error(`Error: ${result.message}`);
      process.exit(2);
    }
    console.log(result.message);
    if (result.eventId !== undefined) console.log(`Tombstone event: ${result.eventId}`);
  } catch (err: any) {
    try { closeDatabase(); } catch {}
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }
}
