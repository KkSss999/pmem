import * as path from 'path';
import {
  fileExists,
  readFile,
  writeFile,
  atomicWrite,
  ensureDir,
  isPathMatch
} from '../core/fs';
import { loadManifest, saveManifest } from '../core/manifest';
import { rebuildCommand } from './rebuild';
import {
  openDatabase,
  createSchema,
  insertDirtyFlag,
  resolveDirtyFlags,
  insertUpdateLog,
  getActiveSession,
  closeDatabase
} from '../core/db';
import { getChangedFiles } from './status';

import { writeManagedNext } from '../core/next';

export function syncCommand(options: { summary?: string; next?: string }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  // Backup file states for atomicity / rollback
  const manifestPath = path.join(pmemPath, 'manifest.yml');
  const dirtyPath = path.join(pmemPath, '.dirty');
  const nextPath = path.join(pmemPath, 'next.md');

  const manifestBackup = fileExists(manifestPath) ? readFile(manifestPath) : null;
  const dirtyBackup = fileExists(dirtyPath) ? readFile(dirtyPath) : null;
  const nextBackup = fileExists(nextPath) ? readFile(nextPath) : null;
  const dbPath = path.join(pmemPath, 'pmem.db');

  let db: any = null;
  let transactionActive = false;
  let createdTracePath: string | null = null;

  try {
    // 1. Detect changes
    const changes = getChangedFiles(cwd);
    if (changes.length === 0) {
      console.log('No changed files detected. Memory is up-to-date.');
      return;
    }

    // 2. Mark dirty
    if (!fileExists(dbPath)) {
      throw new Error('SQLite database not found. Run pmem rebuild first.');
    }
    db = openDatabase(pmemPath);
    createSchema(db);

    // Start SQLite transaction
    db.prepare('BEGIN TRANSACTION').run();
    transactionActive = true;

    const activeSession = getActiveSession(db);
    const dirtyCards: string[] = [];

    // Retrieve all paths for precise relative path matching
    const allPaths = db.prepare(
      "SELECT card_id, path FROM paths"
    ).all() as Array<{ card_id: string; path: string }>;

    for (const change of changes) {
      for (const p of allPaths) {
        if (isPathMatch(change.path, p.path)) {
          if (!dirtyCards.includes(p.card_id)) {
            insertDirtyFlag(db, 'card', p.card_id, 'file_changed: ' + change.path, activeSession?.id);
            dirtyCards.push(p.card_id);
          }
        }
      }
    }

    // Update manifest dirty state & write .dirty file
    const manifest = loadManifest(pmemPath);
    const timestamp = new Date().toISOString();
    if (dirtyCards.length > 0 && manifest) {
      manifest.memory_status.dirty = true;
      manifest.memory_status.dirty_reason = `auto_sync: ${dirtyCards.length} cards dirty`;
      manifest.memory_status.dirty_since = timestamp;
      saveManifest(pmemPath, manifest);

      atomicWrite(dirtyPath, `reason: auto_sync: ${dirtyCards.length} cards dirty\nsince: ${timestamp}\n`);
      insertDirtyFlag(db, 'project', '.pmem', `auto_sync: ${dirtyCards.length} cards dirty`, activeSession?.id);
    }

    // 3. Confirm update if summary is provided
    if (options.summary) {
      if (options.next) {
        writeManagedNext(pmemPath, {
          nextStep: options.next,
          why: 'Confirmed during sync.',
          context: ['Run `pmem recall` for full context.']
        });
      }

      const today = new Date().toISOString().split('T')[0];
      const traceDir = path.join(pmemPath, 'traces');
      ensureDir(traceDir);

      const fs = require('fs');
      const existingTraces = fs.readdirSync(traceDir)
        .filter((f: string) => f.startsWith(today))
        .length;

      const traceNum = String(existingTraces + 1).padStart(3, '0');
      createdTracePath = path.join(traceDir, `${today}-${traceNum}.md`);

      atomicWrite(createdTracePath, `---\nid: trace.${today}-${traceNum}\ntype: trace\ncreated: ${today}\n---\n\n# Trace: ${options.summary}\n\n## What Changed\n${options.summary}\n\n## Next\n${options.next || 'Continue as planned.'}\n`);

      // Resolve project level dirty flag and log update
      resolveDirtyFlags(db, 'project', '.pmem');
      insertUpdateLog(db, 'confirm_update', options.summary, activeSession?.id, [`trace.${today}-${traceNum}`], true);

      // Clean up dirty state in files
      if (fileExists(dirtyPath)) {
        fs.unlinkSync(dirtyPath);
      }
      if (manifest) {
        manifest.memory_status.dirty = false;
        manifest.memory_status.dirty_reason = null;
        manifest.memory_status.dirty_since = null;
        saveManifest(pmemPath, manifest);
      }
    }

    // Commit SQLite transaction
    db.prepare('COMMIT').run();
    transactionActive = false;
    closeDatabase();

    // Rebuild index and output sync status
    if (options.summary) {
      console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
      if (createdTracePath) {
        const relativeTrace = path.relative(cwd, createdTracePath);
        console.log(`Trace written: ${relativeTrace}`);
      }
      console.log('Rebuilding indexes...');
      rebuildCommand();
      console.log('\n✓ Memory sync and update completed.');
    } else {
      if (dirtyCards.length > 0) {
        console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
        console.log('\nRecommended: run `pmem sync -s "<summary>" -n "<next>"` to confirm and sync memory.');
      } else {
        console.log('No related cards found for changed files.');
      }
    }

  } catch (err: any) {
    console.error('Error during pmem sync:', err.message);

    // Rollback SQLite transaction
    if (db && transactionActive) {
      try {
        db.prepare('ROLLBACK').run();
      } catch (rollbackErr) {
        // ignore
      }
    }
    try {
      closeDatabase();
    } catch {}

    // Rollback files
    const fs = require('fs');
    if (manifestBackup !== null) {
      writeFile(manifestPath, manifestBackup);
    }
    if (dirtyBackup !== null) {
      writeFile(dirtyPath, dirtyBackup);
    } else if (fileExists(dirtyPath)) {
      try { fs.unlinkSync(dirtyPath); } catch {}
    }
    if (nextBackup !== null) {
      writeFile(nextPath, nextBackup);
    } else if (fileExists(nextPath)) {
      try { fs.unlinkSync(nextPath); } catch {}
    }
    if (createdTracePath && fileExists(createdTracePath)) {
      try { fs.unlinkSync(createdTracePath); } catch {}
    }

    console.log('Rollback completed cleanly.');
    process.exit(2);
  }
}
