import * as path from 'path';
import { execSync } from 'child_process';
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
  suggest?: boolean;
  applySuggestion?: string;
  format?: string;
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

  // --suggest: show intelligent update suggestions
  if (options.suggest) {
    suggestActions(pmemPath, options.format);
    return;
  }

  // --apply-suggestion: apply a specific suggestion
  if (options.applySuggestion) {
    applySuggestionAction(pmemPath, options.applySuggestion);
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

export function markDirtyCommand(reason: string, options: { auto?: boolean } = {}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // --auto: detect changed files via git and mark related cards as dirty
  if (options.auto) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (fileExists(dbPath)) {
      try {
        const db = openDatabase(pmemPath);
        const output = execSync('git status --porcelain', { encoding: 'utf8', cwd });
        const changedFiles = output.trim().split('\n').filter(Boolean).map(line => {
          // git status --porcelain: first two chars are status, path starts at index 3
          return line.slice(3).trim();
        });

        const activeSession = getActiveSession(db);
        const dirtyCards: string[] = [];

        for (const filePath of changedFiles) {
          const rows = db.prepare(
            "SELECT card_id FROM paths WHERE ? LIKE '%' || path || '%'"
          ).all(filePath) as Array<{ card_id: string }>;
          for (const row of rows) {
            if (!dirtyCards.includes(row.card_id)) {
              insertDirtyFlag(db, 'card', row.card_id, 'file_changed: ' + filePath, activeSession?.id);
              dirtyCards.push(row.card_id);
            }
          }
        }

        closeDatabase();

        if (dirtyCards.length > 0) {
          console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
          return;
        } else {
          console.log('No related cards found for changed files.');
          process.exit(1);
        }
      } catch (err) {
        console.error('Error during auto dirty detection:', err);
        process.exit(2);
      }
    }
    // DB doesn't exist: fall through to existing global dirty behavior
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

// === P1: suggestActions — intelligent update suggestions ===

interface Suggestion {
  id: string;
  action: string;
  target: string;
  reason: string;
  priority: string;
}

function generateSuggestions(pmemPath: string): {
  dirtyFlags: Array<{ scope: string; target: string; reason: string; created_at: string }>;
  stateFreshness: 'stale' | 'fresh';
  suggestions: Suggestion[];
} {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    console.log('No SQLite database. Run pmem rebuild first.');
    process.exit(2);
  }

  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(pmemPath);
  } catch {
    console.log('No SQLite database. Run pmem rebuild first.');
    process.exit(2);
  }

  const unresolved = getUnresolvedDirtyFlags(db);
  const suggestions: Suggestion[] = [];

  // Card-level dirty flags → update_card suggestions
  for (const flag of unresolved) {
    if (flag.scope === 'card') {
      suggestions.push({
        id: `suggest-${suggestions.length + 1}`,
        action: 'update_card',
        target: flag.target,
        reason: flag.reason,
        priority: 'high',
      });
    }
  }

  // Project-level dirty → create_trace or confirm suggestions
  for (const flag of unresolved) {
    if (flag.scope === 'project') {
      suggestions.push({
        id: `suggest-${suggestions.length + 1}`,
        action: 'create_trace',
        target: flag.target,
        reason: flag.reason,
        priority: 'medium',
      });
    }
  }

  // Check state.md freshness
  let stateFreshness: 'stale' | 'fresh' = 'fresh';
  const statePath = path.join(pmemPath, 'state.md');
  if (fileExists(statePath)) {
    const fs = require('fs');
    const stat = fs.statSync(statePath);
    const hoursSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    if (hoursSinceUpdate > 24) {
      stateFreshness = 'stale';
    }
  }

  if (stateFreshness === 'stale') {
    suggestions.push({
      id: `suggest-${suggestions.length + 1}`,
      action: 'update_state',
      target: 'state.md',
      reason: 'state.md has not been updated in over 24 hours',
      priority: 'medium',
    });
  }

  // Check next.md content
  const nextPath = path.join(pmemPath, 'next.md');
  let nextEmpty = false;
  if (fileExists(nextPath)) {
    const content = readFile(nextPath) || '';
    if (content.replace(/#.*\n/g, '').trim().length < 50) {
      nextEmpty = true;
    }
  }

  if (nextEmpty) {
    suggestions.push({
      id: `suggest-${suggestions.length + 1}`,
      action: 'update_next',
      target: 'next.md',
      reason: 'next.md appears to have minimal content',
      priority: 'low',
    });
  }

  closeDatabase();
  return { dirtyFlags: unresolved, stateFreshness, suggestions };
}

function suggestActions(pmemPath: string, format?: string): void {
  const { dirtyFlags, stateFreshness, suggestions } = generateSuggestions(pmemPath);

  if (format === 'json') {
    console.log(JSON.stringify({
      dirty_flags: dirtyFlags,
      state_freshness: stateFreshness,
      suggestions,
    }, null, 2));
  } else {
    if (dirtyFlags.length > 0) {
      console.log(`Dirty flags: ${dirtyFlags.length}`);
      for (const flag of dirtyFlags) {
        console.log(`  [${flag.scope}] ${flag.target}: ${flag.reason}`);
      }
    } else {
      console.log('No unresolved dirty flags.');
    }
    console.log(`State freshness: ${stateFreshness}`);

    if (suggestions.length > 0) {
      console.log(`\nSuggestions (${suggestions.length}):`);
      for (const s of suggestions) {
        console.log(`  ${s.id}: [${s.priority}] ${s.action} ${s.target}`);
        console.log(`    ${s.reason}`);
      }
    } else {
      console.log('\nNo suggestions. Memory is up to date.');
    }
  }

  const hasSuggestions = suggestions.length > 0;
  process.exit(hasSuggestions ? 1 : 0);
}

function applySuggestionAction(pmemPath: string, suggestionId: string): void {
  // Re-derive suggestions to find the matching one
  const { suggestions, dirtyFlags } = generateSuggestions(pmemPath);

  const match = suggestions.find(s => s.id === suggestionId);
  if (!match) {
    console.log(`Suggestion "${suggestionId}" not found. Available suggestions:`);
    for (const s of suggestions) {
      console.log(`  ${s.id}: ${s.action} ${s.target}`);
    }
    process.exit(2);
  }

  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    console.log('No SQLite database. Run pmem rebuild first.');
    process.exit(2);
  }

  switch (match.action) {
    case 'update_card': {
      const db = openDatabase(pmemPath);
      // Mark the card's last_verified_at as expired
      db.prepare(
        "UPDATE cards SET last_verified_at = ? WHERE id = ?"
      ).run(new Date(0).toISOString(), match.target);
      closeDatabase();
      console.log(`Marked card "${match.target}" as needing verification.`);
      console.log(`  Reason: ${match.reason}`);
      break;
    }
    case 'create_trace': {
      const today = new Date().toISOString().split('T')[0];
      const traceDir = path.join(pmemPath, 'traces');
      ensureDir(traceDir);

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

# Trace: ${match.reason}

## What Changed
${match.reason}

## Next
Continue as planned.
`);
      console.log(`Auto-created trace: traces/${today}-${traceNum}.md`);
      console.log(`  Reason: ${match.reason}`);

      // Log in SQLite
      const db = openDatabase(pmemPath);
      const activeSession = getActiveSession(db);
      insertUpdateLog(db, 'auto_trace', match.reason, activeSession?.id, [`trace.${today}-${traceNum}`], true);
      closeDatabase();
      break;
    }
    case 'update_state': {
      console.log(`Action required: ${match.reason}`);
      console.log('  Please run `pmem update --confirm` to update state.md.');
      break;
    }
    case 'update_next': {
      console.log(`Action required: ${match.reason}`);
      console.log('  Please run `pmem update --confirm --next "<next step>"` to update next.md.');
      break;
    }
    default: {
      console.log(`Unknown action "${match.action}" for suggestion ${suggestionId}.`);
      process.exit(2);
    }
  }

  process.exit(0);
}
