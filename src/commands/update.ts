import * as path from 'path';
import { readFile, writeFile, atomicWrite, acquireLock, releaseLock, fileExists, ensureDir } from '../core/fs';
import { loadManifest, saveManifest } from '../core/manifest';
import { rebuildCommand } from './rebuild';
import { openDatabase, createSchema, insertDirtyFlag, resolveDirtyFlags, getUnresolvedDirtyFlags, insertUpdateLog, getRecentUpdateLogs, getActiveSession, closeDatabase } from '../core/db';

const PMEM_DIR = '.pmem';

export function updateCommand(options: {
  auto?: boolean;
  confirm?: boolean;
  force?: boolean;
  summary?: string;
  next?: string;
}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    console.log('No manifest found. Run `pmem init` first.');
    return;
  }

  // --auto: detect changes, suggest actions
  if (options.auto) {
    autoUpdate(pmemPath, manifest);
    return;
  }

  // --confirm or --force: write changes
  if (options.confirm || options.force) {
    confirmUpdate(pmemPath, options.summary, options.next);
    return;
  }

  // no flag: show current dirty state
  showDirtyState(pmemPath);
}

export function markDirtyCommand(reason: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const dirtyFile = path.join(pmemPath, '.dirty');
  const timestamp = new Date().toISOString();
  atomicWrite(dirtyFile, `reason: ${reason}\nsince: ${timestamp}\n`);

  // Update manifest dirty state
  const manifest = loadManifest(pmemPath);
  if (manifest) {
    // Update manifest.memory_status for dirty tracking
    manifest.memory_status.dirty = true;
    manifest.memory_status.dirty_reason = reason;
    manifest.memory_status.dirty_since = timestamp;
    saveManifest(pmemPath, manifest);
    console.log(`Memory marked as dirty.`);
    console.log(`  Reason: ${reason}`);
    console.log(`  Since: ${timestamp}`);
    console.log(`\nRun \`pmem update --auto\` to detect changes or \`pmem update --confirm\` to record them.`);
  }

  // SQLite: log dirty flag (additive — does not replace file-based dirty tracking)
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      const db = openDatabase(pmemPath);
      const activeSession = getActiveSession(db);
      insertDirtyFlag(db, 'project', '.pmem', reason, activeSession?.id);
      closeDatabase();
      console.log(`  Dirty flag logged to SQLite.`);
    } catch {
      // DB not available or schema not yet created — skip SQLite
    }
  }
}

function showDirtyState(pmemPath: string): void {
  const dirtyFile = path.join(pmemPath, '.dirty');
  if (fileExists(dirtyFile)) {
    const content = readFile(dirtyFile);
    console.log('Memory is marked as dirty:');
    console.log(content);
    console.log('Run `pmem update --auto` to detect changes.');
  } else {
    console.log('Memory is clean.');
  }
}

function autoUpdate(pmemPath: string, manifest: unknown): void {
  console.log('Auto-detecting changes...\n');

  // Check if dirty
  const dirtyFile = path.join(pmemPath, '.dirty');
  const isDirty = fileExists(dirtyFile);

  if (isDirty) {
    const content = readFile(dirtyFile);
    console.log('Dirty memory detected:');
    console.log(content);
  }

  // Check state.md freshness
  const statePath = path.join(pmemPath, 'state.md');
  if (fileExists(statePath)) {
    const stateStat = require('fs').statSync(statePath);
    const hoursSinceUpdate = (Date.now() - stateStat.mtimeMs) / (1000 * 60 * 60);
    if (hoursSinceUpdate > 24) {
      console.log(`- state.md was last updated ${hoursSinceUpdate.toFixed(1)} hours ago.`);
    }
  }

  // Check if next.md is empty
  const nextPath = path.join(pmemPath, 'next.md');
  if (fileExists(nextPath)) {
    const nextContent = readFile(nextPath) || '';
    if (nextContent.replace(/#.*\n/g, '').trim().length < 50) {
      console.log('- next.md appears to have minimal content.');
    }
  }

  // Suggest: check for new files in project that aren't in memory
  const sourceFiles = listSourceFiles(process.cwd());
  console.log(`\nProject source files: ${sourceFiles.length}`);

  console.log('\nSuggested actions:');
  if (isDirty) {
    console.log('  1. Review changes and update memory cards.');
    console.log('  2. Create decision cards if architecture changed.');
    console.log('  3. Run `pmem update --confirm --summary "<what changed>" --next "<next step>"`');
  } else {
    console.log('  Memory appears up to date. No action needed.');
  }

  // SQLite: show unresolved dirty flags and recent update activity
  const updateDbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(updateDbPath)) {
    try {
      const db = openDatabase(pmemPath);
      const unresolved = getUnresolvedDirtyFlags(db);
      if (unresolved.length > 0) {
        console.log(`\nUnresolved dirty flags in SQLite: ${unresolved.length}`);
      }
      const recentLogs = getRecentUpdateLogs(db, 5);
      if (recentLogs.length > 0) {
        console.log('\nRecent update activity:');
        for (const log of recentLogs) {
          const icon = log.success ? '✓' : '✗';
          console.log(`  ${icon} [${log.created_at.slice(0, 16)}] ${log.action}${log.summary ? ': ' + log.summary.slice(0, 60) : ''}`);
        }
      }
      closeDatabase();
    } catch {
      // DB not available — skip SQLite
    }
  }
}

function confirmUpdate(pmemPath: string, summary?: string, next?: string): void {
  const lockPath = path.join(pmemPath, '.lock');
  if (!acquireLock(lockPath)) {
    console.log('Failed to acquire pmem lock. Another pmem update may be running.');
    console.log('No memory was written. Try again later.');
    return;
  }

  try {
    // Update next.md
    if (next) {
      const nextPath = path.join(pmemPath, 'next.md');
      atomicWrite(nextPath, `# Next Steps

## Recommended Next Step
${next}

## Why
Confirmed during update.

## Needed Context
Run \`pmem recall\` for full context.
`);
    }

    let sqliteLogged = false;

    // Add trace if summary provided
    if (summary) {
      const today = new Date().toISOString().split('T')[0];
      const traceDir = path.join(pmemPath, 'traces');
      ensureDir(traceDir);

      // Find the next trace number
      const fs = require('fs');
      const existingTraces = fs.readdirSync(traceDir)
        .filter((f: string) => f.startsWith(today))
        .length;

      const traceNum = String(existingTraces + 1).padStart(3, '0');
      const traceFile = path.join(traceDir, `${today}-${traceNum}.md`);

      atomicWrite(traceFile, `---
id: trace.${today}-${traceNum}
type: trace
created: ${today}
---

# Trace: ${summary}

## What Changed
${summary}

## Next
${next || 'Continue as planned.'}
`);
      console.log(`Trace written: traces/${today}-${traceNum}.md`);

      // SQLite: resolve dirty flags and log the update (additive)
      const confirmDbPath = path.join(pmemPath, 'pmem.db');
      if (fileExists(confirmDbPath)) {
        try {
          const db = openDatabase(pmemPath);
          const activeSession = getActiveSession(db);
          resolveDirtyFlags(db, 'project', '.pmem');
          insertUpdateLog(db, 'confirm_update', summary, activeSession?.id, [`trace.${today}-${traceNum}`], true);
          closeDatabase();
          sqliteLogged = true;
        } catch {
          // DB not available — skip SQLite
        }
      }
    }

    // Clear dirty flag
    const dirtyFile = path.join(pmemPath, '.dirty');
    if (fileExists(dirtyFile)) {
      require('fs').unlinkSync(dirtyFile);
    }

    // Clear manifest dirty state
    const manifest = loadManifest(pmemPath);
    if (manifest) {
      manifest.memory_status.dirty = false;
      manifest.memory_status.dirty_reason = null;
      manifest.memory_status.dirty_since = null;
      saveManifest(pmemPath, manifest);
    }

    // Rebuild indexes
    console.log('Rebuilding indexes...');
    rebuildCommand();

    console.log('\n✓ Memory updated.');

    if (sqliteLogged) {
      console.log('  Update logged to SQLite.');
    }
  } finally {
    releaseLock(lockPath);
  }
}

function listSourceFiles(root: string): string[] {
  const fs = require('fs');
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', '.pmem', 'dist', 'build', '.claude']);

  function walk(dir: string): void {
    if (!fileExists(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|js|tsx|jsx|py|rs|go|java|rb|php)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(root);
  return results;
}
