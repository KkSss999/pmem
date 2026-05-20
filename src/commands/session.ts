import * as path from 'path';
import { fileExists } from '../core/fs';
import { openDatabase, createSchema, startSession, endSession, getActiveSession, closeDatabase } from '../core/db';

const PMEM_DIR = '.pmem';

export function sessionStartCommand(agentName?: string): void {
  const pmemPath = path.join(process.cwd(), PMEM_DIR);

  // 1. Check .pmem/ exists
  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // Check DB file exists
  if (!fileExists(path.join(pmemPath, 'pmem.db'))) {
    console.log('No SQLite database found. Run `pmem rebuild` first.');
    return;
  }

  // 2. Open SQLite DB, createSchema
  const db = openDatabase(pmemPath);
  createSchema(db);

  // 3. Check if there's already an active session
  const active = getActiveSession(db);
  if (active) {
    console.log(`Active session already exists: ${active.id}. End it first with \`pmem session end\`.`);
    closeDatabase();
    return;
  }

  // 4. Generate session ID: "session-YYYYMMDD-HHmmss"
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const sessionId = `session-${dateStr}-${timeStr}`;

  // 5. Call startSession
  startSession(db, sessionId, agentName);

  // 6. Print
  console.log(`Session started: ${sessionId}`);
  if (agentName) {
    console.log(`  Agent: ${agentName}`);
  }
  console.log('  Run `pmem session end` when done.');

  // 7. closeDatabase
  closeDatabase();
}

export function sessionEndCommand(taskSummary?: string): void {
  const pmemPath = path.join(process.cwd(), PMEM_DIR);

  // 1. Check .pmem/ exists
  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // Check DB file exists
  if (!fileExists(path.join(pmemPath, 'pmem.db'))) {
    console.log('No SQLite database found. Run `pmem rebuild` first.');
    return;
  }

  // 2. Open DB, createSchema
  const db = openDatabase(pmemPath);
  createSchema(db);

  // 3. Get active session
  const active = getActiveSession(db);

  // 4. If no active session
  if (!active) {
    console.log('No active session found.');
    closeDatabase();
    return;
  }

  // 5. Call endSession
  endSession(db, active.id, 'completed', taskSummary);

  // 6. Print
  console.log(`Session ended: ${active.id}`);
  if (taskSummary) {
    console.log(`  Summary: ${taskSummary}`);
  }

  // 7. closeDatabase
  closeDatabase();
}
