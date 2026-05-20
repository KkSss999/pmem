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

  // 6. Query session update log for summary
  const logs = db.prepare(
    "SELECT action, summary, created_at, success, affected_cards FROM update_log WHERE session_id = ? ORDER BY created_at"
  ).all(active.id) as Array<{ action: string; summary: string | null; created_at: string; success: number; affected_cards: string | null }>;

  // Count actions by type
  let updateCount = 0, traceCount = 0, errorCount = 0;
  const allAffected = new Set<string>();
  for (const log of logs) {
    if (!log.success) { errorCount++; continue; }
    if (log.action === 'confirm_update') updateCount++;
    if (log.action === 'create_trace') traceCount++;
    if (log.affected_cards) {
      try {
        const cards = JSON.parse(log.affected_cards) as string[];
        cards.forEach(c => allAffected.add(c));
      } catch {}
    }
  }

  // Query unresolved dirty flags for this session
  const dirtyFlags = db.prepare(
    "SELECT scope, target, reason FROM dirty_flags WHERE session_id = ? AND resolved_at IS NULL"
  ).all(active.id) as Array<{ scope: string; target: string; reason: string }>;

  // Print summary
  console.log(`Session ended: ${active.id}`);
  if (taskSummary) console.log(`  Summary: ${taskSummary}`);
  console.log(`  Actions: ${updateCount} update(s), ${traceCount} trace(s) created${errorCount > 0 ? `, ${errorCount} error(s)` : ''}`);
  if (allAffected.size > 0) {
    console.log(`  Cards affected: ${[...allAffected].join(', ')}`);
  }
  if (dirtyFlags.length > 0) {
    console.log(`  Unresolved dirty flags: ${dirtyFlags.length}`);
    for (const df of dirtyFlags) {
      console.log(`    [${df.scope}] ${df.target}: ${df.reason}`);
    }
  }
  console.log(`\nRun: pmem verify`);

  // 7. closeDatabase
  closeDatabase();
}
