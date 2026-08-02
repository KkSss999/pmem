import * as path from 'path';
import { readFile, writeFile, atomicWrite, acquireLock, releaseLock, fileExists, ensureDir } from '../core/fs';
import { loadManifest, saveManifest } from '../core/manifest';
import { rebuildCommand } from './rebuild';
import { insertDirtyFlag, resolveDirtyFlags, getUnresolvedDirtyFlags, getUnresolvedDirtyFlagsDetailed, insertUpdateLog, getRecentUpdateLogs, getActiveSession, getInferredEdges, updateEdgeSource, deleteEdgesByIds, closeDatabase } from '../runtime/maintenance';
import { openMaintenanceDatabase, type MaintenanceDatabase } from '../runtime/maintenance';
import type { DirtyFlagDetailed } from '../runtime/maintenance';
import { checkStaleMemory } from '../core/consistency';
import type { AggregatedSuggestion, SuggestSummary, SuggestGroups, ConsistencyIssue } from '../types';

import { writeManagedNext } from '../core/next';
import { acknowledgeStatusChanges, statusQuery } from '../core/query/status';
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
  includeHistory?: boolean;
  acceptEdges?: string;
  rejectEdges?: string;
  refreshVerified?: string;
  replaceManagedBlocks?: boolean;
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

  // --accept-edges / --reject-edges: manage inferred edges
  if (options.acceptEdges || options.rejectEdges) {
    manageEdges(pmemPath, options.acceptEdges, options.rejectEdges);
    return;
  }

  // --suggest: show intelligent update suggestions
  if (options.suggest) {
    suggestActions(pmemPath, options.format, options.includeHistory);
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
    confirmUpdate(pmemPath, options.summary, options.next, options.refreshVerified, options.replaceManagedBlocks);
    return;
  }

  // no flag: show current dirty state
  showDirtyState(pmemPath);
}

export function markDirtyCommand(
  reason: string,
  options: { auto?: boolean; cardIds?: string[]; format?: string } = {}
): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const format = options.format ?? 'compact';

  if (!fileExists(pmemPath)) {
    if (format === 'json') {
      console.log(JSON.stringify({
        command: 'mark-dirty',
        state: 'no_pmem',
        message: 'No .pmem directory found. Run `pmem init` first.',
        changed_files: [],
        marked_card_ids: [],
      }, null, 2));
    } else {
      console.log('No .pmem directory found. Run `pmem init` first.');
    }
    return;
  }

  const nextActions = [{
    command: 'pmem update --suggest --format json',
    reason: 'Scan for suggestions regardless',
    blocking: false,
  }];

  // --card <id>: explicitly mark specific cards as dirty
  if (options.cardIds && options.cardIds.length > 0) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!fileExists(dbPath)) {
      console.log('No SQLite database found. Run `pmem rebuild` first.');
      process.exit(2);
    }

    try {
      const db = openMaintenanceDatabase(pmemPath);
      const activeSession = getActiveSession(db);
      const markedIds: string[] = [];
      const notFoundIds: string[] = [];

      for (const cardId of options.cardIds) {
        const card = db.prepare('SELECT id FROM cards WHERE id = ? AND is_deleted = 0').get(cardId) as { id: string } | undefined;
        if (card) {
          insertDirtyFlag(db, 'card', cardId, reason, activeSession?.id);
          markedIds.push(cardId);
          if (format !== 'json') {
            console.log(`Marked card dirty: ${cardId}`);
          }
        } else {
          notFoundIds.push(cardId);
          if (format !== 'json') {
            console.log(`Card not found or deleted: ${cardId}`);
          }
        }
      }

      // Also mark project-level dirty
      const manifest = loadManifest(pmemPath);
      if (manifest) {
        const timestamp = new Date().toISOString();
        manifest.memory_status.dirty = true;
        manifest.memory_status.dirty_reason = reason;
        manifest.memory_status.dirty_since = timestamp;
        saveManifest(pmemPath, manifest);
        insertDirtyFlag(db, 'project', '.pmem', reason, activeSession?.id);
      }

      closeDatabase();

      if (format === 'json') {
        console.log(JSON.stringify({
          command: 'mark-dirty',
          state: 'marked_dirty',
          reason,
          marked_card_ids: markedIds,
          not_found_ids: notFoundIds,
          next_actions: nextActions,
        }, null, 2));
      }

      return;
    } catch (err) {
      console.error('Could not mark cards as dirty:', err);
      process.exit(2);
    }
  }

  // --auto: use the canonical git/mtime status snapshot and mark exact matches.
  if (options.auto) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (fileExists(dbPath)) {
      try {
        const db = openMaintenanceDatabase(pmemPath);
        const status = statusQuery(pmemPath, { cwd, db });
        const changedFiles = status.changes.map(change => change.path);

        const activeSession = getActiveSession(db);
        const dirtyCards: string[] = [];
        const acknowledgedPaths = new Set<string>();

        for (const change of status.changes) {
          for (const related of change.related_cards) {
            if (related.match_type !== 'exact') continue;
            if (!dirtyCards.includes(related.card_id)) {
              insertDirtyFlag(db, 'card', related.card_id, 'file_changed: ' + change.path, activeSession?.id);
              dirtyCards.push(related.card_id);
            }
            acknowledgedPaths.add(change.path);
          }
        }

        closeDatabase();

        if (dirtyCards.length > 0) {
          // Acknowledge only after the dirty flags have been durably written.
          // A preceding read-only `pmem status` therefore cannot consume the
          // changes before this mutation runs.
          acknowledgeStatusChanges(pmemPath, [...acknowledgedPaths]);
          if (format === 'json') {
            console.log(JSON.stringify({
              command: 'mark-dirty --auto',
              state: 'marked_dirty',
              changed_files: changedFiles,
              marked_card_ids: dirtyCards,
              next_actions: nextActions,
            }, null, 2));
          } else {
            console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
          }
          return;
        } else {
          // No-op case: changed files exist but none map to known cards.
          // Exit 0 (NOT process.exit(1)) so documented `&&` chains keep running.
          if (format === 'json') {
            console.log(JSON.stringify({
              command: 'mark-dirty --auto',
              state: 'no_related_cards',
              changed_files: changedFiles,
              marked_card_ids: [],
              next_actions: nextActions,
            }, null, 2));
          } else {
            console.log('No related cards found for changed files.');
            console.log('(If files changed were only .pmem/**/*.md or outside pmem scope, this is expected.)');
          }
          return;
        }
      } catch (err) {
        try { closeDatabase(); } catch {}
        console.error('Could not auto-detect changed files.');
        console.error('Run `pmem status` to check change detection, or `pmem update --confirm` to manually record changes.');
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

    if (format === 'json') {
      console.log(JSON.stringify({
        command: 'mark-dirty',
        state: 'marked_dirty',
        reason,
        since: timestamp,
        next_actions: nextActions,
      }, null, 2));
    } else {
      console.log(`Memory marked as dirty.`);
      console.log(`  Reason: ${reason}`);
      console.log(`  Since: ${timestamp}`);
      console.log(`\nRun \`pmem update --auto\` to detect changes or \`pmem update --confirm\` to record them.`);
    }
  }

  // SQLite: log dirty flag (additive — does not replace file-based dirty tracking)
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      const db = openMaintenanceDatabase(pmemPath);
      const activeSession = getActiveSession(db);
      insertDirtyFlag(db, 'project', '.pmem', reason, activeSession?.id);
      closeDatabase();
      if (format !== 'json') {
        console.log(`  Dirty flag logged to SQLite.`);
      }
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
      const db = openMaintenanceDatabase(pmemPath);
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

function confirmUpdate(pmemPath: string, summary?: string, next?: string, refreshVerified?: string, replaceManagedBlocks?: boolean): void {
  const lockPath = path.join(pmemPath, '.lock');
  if (!acquireLock(lockPath)) {
    console.log('Failed to acquire pmem lock after 3s.');
    console.log('  The lock at .pmem/.lock may be held by another pmem process, or a stale lock from a previous crash.');
    console.log('  → Run: pmem verify --fix-locks  (to check and clean stale locks)');
    console.log('  → Or:  pmem doctor              (to diagnose lock status)');
    console.log('  If no other pmem process is running, delete .pmem/.lock manually.');
    console.log('No memory was written. Try again after resolving the lock.');
    return;
  }

  try {
    // Update next.md
    // v0.7.6 fix U3: default behavior preserves manually-curated
    // ## Why / ## Needed Context (partial merge). Pass --replace-managed-blocks
    // to fully replace the managed block.
    if (next) {
      writeManagedNext(pmemPath, {
        nextStep: next,
        replaceManaged: replaceManagedBlocks === true,
      });
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
          const db = openMaintenanceDatabase(pmemPath);
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

    // --refresh-verified: bump last_verified on specified cards.
    // MUST run BEFORE rebuildCommand() so the updated frontmatter
    // is picked up by the rebuild and SQLite hashes stay in sync.
    if (refreshVerified) {
      const cardIds = refreshVerified.split(',').map(s => s.trim()).filter(Boolean);
      const refreshDbPath = path.join(pmemPath, 'pmem.db');
      if (fileExists(refreshDbPath) && cardIds.length > 0) {
        try {
          const refreshDb = openMaintenanceDatabase(pmemPath);  // open once
          const refreshed: string[] = [];
          for (const cardId of cardIds) {
            const card = refreshDb.prepare('SELECT file_path FROM cards WHERE id = ?').get(cardId) as { file_path: string } | undefined;
            if (card) {
              const cardFilePath = path.join(process.cwd(), card.file_path);
              if (fileExists(cardFilePath)) {
                const content = readFile(cardFilePath);
                if (content) {
                  const match = content.match(/^---\n([\s\S]*?)\n---/);
                  if (match) {
                    const frontmatterText = match[1];
                    const nowStr = new Date().toISOString();
                    let newFmText = frontmatterText;
                    const regex = /^last_verified:.*$/m;
                    if (regex.test(frontmatterText)) {
                      newFmText = frontmatterText.replace(regex, `last_verified: "${nowStr}"`);
                    } else {
                      newFmText = frontmatterText.trimEnd() + `\nlast_verified: "${nowStr}"`;
                    }
                    const newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${newFmText}\n---`);
                    writeFile(cardFilePath, newContent);
                    refreshed.push(cardId);
                  }
                }
              }
            }
          }
          if (refreshed.length > 0) {
            console.log(`Refreshed last_verified for: ${refreshed.join(', ')}`);
          }
        } catch {
          // skip cards that can't be refreshed
        }
      }
    }

    // Rebuild indexes — picks up frontmatter changes from --refresh-verified above
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

// === v0.6.1: Actionable Update Suggestions ===

interface SuggestionReport {
  summary: SuggestSummary;
  message: string;
  /**
   * v0.7.6 fix U2: machine-readable state for `update --suggest`.
   * - `no_cards`: project has zero cards (bootstrap needed).
   * - `no_affected_cards`: cards exist but no suggestions produced.
   * - `has_suggestions`: at least one blocking/warning/info suggestion.
   */
  state: 'no_cards' | 'no_affected_cards' | 'has_suggestions';
  /** Total active card count at time of suggestion generation. */
  card_count: number;
  /** Whether the SQLite index needs to be rebuilt. */
  needs_rebuild: boolean;
  next_steps: string[];
  groups: SuggestGroups;
  error?: boolean;
}

/**
 * Extract the matched file path from a dirty flag reason string.
 * Handles formats like "file_changed: path/to/file" or plain text.
 */
function extractMatchedFile(reason: string): string | null {
  const match = reason.match(/^file_changed:\s*(.+)/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Build the aggregation key for a dirty flag: target + reason + matched_file.
 */
function aggregationKey(flag: DirtyFlagDetailed): string {
  const mf = extractMatchedFile(flag.reason);
  return `${flag.target}||${flag.reason}||${mf ?? ''}`;
}

/**
 * Find the most recent session end time.
 * Returns null if no ended session exists.
 */
function getLatestSessionEnd(pmemPath: string): string | null {
  try {
    const db = openMaintenanceDatabase(pmemPath);
    const row = db.prepare(
      "SELECT ended_at FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1"
    ).get() as { ended_at: string } | undefined;
    return row?.ended_at ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the active (un-ended) session if one exists.
 */
function getActiveSessionStart(pmemPath: string): string | null {
  try {
    const db = openMaintenanceDatabase(pmemPath);
    const row = db.prepare(
      "SELECT started_at FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).get() as { started_at: string } | undefined;
    return row?.started_at ?? null;
  } catch {
    return null;
  }
}

function generateSuggestions(pmemPath: string, includeHistory: boolean = false): SuggestionReport {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    return {
      summary: { affected_cards: 0, blocking: 0, warning: 0, info: 0, duplicates_hidden: 0, historical_hidden: 0, verify_blocking: false },
      message: 'No SQLite database. Run pmem rebuild first.',
      state: 'no_affected_cards',
      card_count: 0,
      needs_rebuild: true,
      next_steps: ['Run `pmem rebuild` to create the database index.'],
      groups: { blocking_for_verify: [], current_suggestions: [], historical_dirty_flags: [] },
      error: true,
    };
  }

  let db: MaintenanceDatabase;
  try {
    db = openMaintenanceDatabase(pmemPath);
  } catch {
    return {
      summary: { affected_cards: 0, blocking: 0, warning: 0, info: 0, duplicates_hidden: 0, historical_hidden: 0, verify_blocking: false },
      message: 'Cannot open database. Run pmem rebuild first.',
      state: 'no_affected_cards',
      card_count: 0,
      needs_rebuild: true,
      next_steps: ['Run `pmem rebuild` to recreate the database.'],
      groups: { blocking_for_verify: [], current_suggestions: [], historical_dirty_flags: [] },
      error: true,
    };
  }

  // 1. Get raw dirty flags with full details
  const allFlags = getUnresolvedDirtyFlagsDetailed(db);

  // 2. Run shared stale-memory consistency check
  const staleIssues = checkStaleMemory(pmemPath);

  // Build lookup: card_id → set of stale file paths
  const staleByCard = new Map<string, Set<string>>();
  for (const issue of staleIssues) {
    if (issue.card_id) {
      if (!staleByCard.has(issue.card_id)) {
        staleByCard.set(issue.card_id, new Set());
      }
      for (const filePath of issue.file_paths ?? (issue.file_path ? [issue.file_path] : [])) {
        staleByCard.get(issue.card_id)!.add(filePath);
      }
    }
  }

  // 3. Aggregate dirty flags by target + reason + matched_file
  const groups = new Map<string, DirtyFlagDetailed[]>();
  for (const flag of allFlags) {
    const key = aggregationKey(flag);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(flag);
  }

  // 4. Get session boundaries for historical classification
  const latestSessionEnd = getLatestSessionEnd(pmemPath);
  const activeSessionStart = getActiveSessionStart(pmemPath);
  const sessionBoundary = latestSessionEnd || activeSessionStart;

  // 5. Get total card count for affected_cards
  const cardCount = getCardCount(pmemPath);

  // 6. Classify each aggregated group
  const blockingForVerify: AggregatedSuggestion[] = [];
  const currentSuggestions: AggregatedSuggestion[] = [];
  const historicalDirtyFlags: AggregatedSuggestion[] = [];

  for (const [key, flags] of groups) {
    const representative = flags[0];
    const matchedFile = extractMatchedFile(representative.reason);

    // Determine if this group blocks verify
    let blocksVerify = false;
    if (representative.scope === 'card' && staleByCard.has(representative.target)) {
      const staleFiles = staleByCard.get(representative.target)!;
      if (matchedFile && staleFiles.has(matchedFile)) {
        blocksVerify = true;
      } else if (!matchedFile) {
        // Card is in stale list, even if we can't match the specific file
        blocksVerify = true;
      }
    }

    // Determine severity
    let severity: 'blocking' | 'warning' | 'info';
    if (blocksVerify) {
      severity = 'blocking';
    } else if (representative.scope === 'card') {
      severity = 'warning';
    } else {
      severity = 'info';
    }

    // Historical classification
    const allCreatedAts = flags.map(f => f.created_at).sort();
    const latestCreated = allCreatedAts[allCreatedAts.length - 1];
    const earliestCreated = allCreatedAts[0];
    const isMulti = flags.length > 1;

    let isHistorical = false;
    let isDuplicate = false;

    if (blocksVerify) {
      // Blocking items are never historical
      isHistorical = false;
      isDuplicate = isMulti;
    } else if (sessionBoundary && latestCreated < sessionBoundary) {
      // All flags are from before the session boundary → historical
      isHistorical = true;
      isDuplicate = isMulti;
    } else if (isMulti && sessionBoundary && latestCreated < sessionBoundary) {
      // Multiple flags, all old → historical duplicate
      isHistorical = true;
      isDuplicate = true;
    } else {
      // Default: keep in current
      isHistorical = false;
      isDuplicate = isMulti;
    }

    const aggregated: AggregatedSuggestion = {
      target: representative.target,
      reason: representative.reason,
      matched_file: matchedFile,
      count: flags.length,
      severity,
      blocks_verify: blocksVerify,
      is_duplicate: isDuplicate,
      is_historical: isHistorical,
      created_at_first: earliestCreated,
      created_at_last: latestCreated,
      sources: flags.map(f => ({
        scope: f.scope,
        target: f.target,
        reason: f.reason,
        created_at: f.created_at,
        session_id: f.session_id,
      })),
    };

    if (blocksVerify) {
      blockingForVerify.push(aggregated);
    } else if (isHistorical) {
      historicalDirtyFlags.push(aggregated);
    } else {
      currentSuggestions.push(aggregated);
    }
  }

  // 7. Compute summary
  const uniqueAffectedCards = new Set<string>();
  for (const item of [...blockingForVerify, ...currentSuggestions]) {
    uniqueAffectedCards.add(item.target);
  }

  const duplicatesHidden = [...blockingForVerify, ...currentSuggestions, ...historicalDirtyFlags]
    .filter(g => g.count > 1)
    .reduce((sum, g) => sum + (g.count - 1), 0);

  const summary: SuggestSummary = {
    affected_cards: uniqueAffectedCards.size,
    blocking: blockingForVerify.length,
    warning: currentSuggestions.filter(g => g.severity === 'warning').length,
    info: currentSuggestions.filter(g => g.severity === 'info').length,
    duplicates_hidden: duplicatesHidden,
    historical_hidden: includeHistory ? 0 : historicalDirtyFlags.length,
    verify_blocking: blockingForVerify.length > 0,
  };

  // 8. Build message and next steps
  // v0.7.6 fix U2: buildSuggestMessage now returns { message, state }.
  const { message, state } = buildSuggestMessage(summary, cardCount);
  const nextSteps = buildSuggestNextSteps(summary, cardCount);

  // v0.7.6 fix U2: also surface `needs_rebuild` from the change graph so
  // agents can tell "no suggestions because change graph is clean" from
  // "no suggestions because index is stale". Best-effort: if statusQuery
  // fails (e.g. not in a git repo, or pmem not initialized), default to false.
  let needsRebuild = false;
  try {
    needsRebuild = statusQuery(pmemPath, { cwd: path.resolve(pmemPath, '..') }).needs_rebuild;
  } catch {
    needsRebuild = false;
  }

  return {
    summary,
    message,
    state,
    card_count: cardCount,
    needs_rebuild: needsRebuild,
    next_steps: nextSteps,
    groups: {
      blocking_for_verify: blockingForVerify,
      current_suggestions: currentSuggestions,
      historical_dirty_flags: includeHistory ? historicalDirtyFlags : [],
    },
  };
}

function suggestActions(pmemPath: string, format?: string, includeHistory?: boolean): void {
  let report = generateSuggestions(pmemPath, includeHistory);
  report = enrichWithEdgeSuggestions(pmemPath, report);

  // v0.7.6 fix U2: re-derive the suggestion state from the (now possibly
  // mutated) summary. enrichWithEdgeSuggestions may have flipped the state
  // from `no_affected_cards` to `has_suggestions` by adding edge reviews.
  if (report.state !== 'no_cards') {
    if (report.summary.blocking > 0 || report.summary.warning > 0 || report.summary.info > 0) {
      report.state = 'has_suggestions';
    } else {
      report.state = 'no_affected_cards';
    }
  }

  if (format === 'json') {
    // v0.7.6 fix U2: also emit state, card_count, blocking/warning/info
    // counts, needs_rebuild, and next_actions so agents can distinguish
    // empty states. Existing fields (summary, message, next_steps, groups)
    // keep their names for backward compatibility.
    console.log(JSON.stringify({
      state: report.state,
      message: report.message,
      card_count: report.card_count,
      needs_rebuild: report.needs_rebuild,
      blocking: report.summary.blocking,
      warning: report.summary.warning,
      info: report.summary.info,
      summary: report.summary,
      next_actions: report.next_steps,
      next_steps: report.next_steps,
      groups: report.groups,
    }, null, 2));
  } else {
    // Compact output
    console.log('Memory update suggestions');
    console.log('');
    console.log(`Affected cards: ${report.summary.affected_cards}`);
    console.log(`Blocking for verify: ${report.summary.blocking}`);
    console.log(`Current suggestions: ${report.summary.warning + report.summary.info}`);
    console.log(`Historical hidden: ${report.summary.historical_hidden}`);
    console.log(`Duplicate flags hidden: ${report.summary.duplicates_hidden}`);

    // Blocking section
    if (report.groups.blocking_for_verify.length > 0) {
      console.log('');
      console.log('Blocking:');
      for (const item of report.groups.blocking_for_verify) {
        const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
        const countPart = item.count > 1 ? `, count ${item.count}` : '';
        console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
      }
    }

    // Current section
    if (report.groups.current_suggestions.length > 0) {
      console.log('');
      console.log('Current:');
      for (const item of report.groups.current_suggestions) {
        const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
        const countPart = item.count > 1 ? `, count ${item.count}` : '';
        console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
      }
    }

    // Historical section (only when --include-history)
    if (includeHistory && report.groups.historical_dirty_flags.length > 0) {
      console.log('');
      console.log('Historical:');
      for (const item of report.groups.historical_dirty_flags) {
        const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
        const countPart = item.count > 1 ? `, count ${item.count}` : '';
        console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
      }
    }

    // v0.7.6 fix U2: show the full message whenever we have suggestions
    // (any severity). Previously only `blocking > 0` triggered this branch,
    // which hid warning/info messages. For `no_cards` / `no_affected_cards`
    // we still want the explanatory line that helps the agent decide what
    // to do next.
    console.log('');
    if (report.state === 'has_suggestions') {
      console.log(report.message);
    } else if (report.state === 'no_cards') {
      console.log(report.message);
      console.log('');
      console.log(`Card count: ${report.card_count}`);
    } else {
      // no_affected_cards
      console.log(report.message);
      if (report.needs_rebuild) {
        console.log('  Note: change graph indicates an index rebuild may be needed.');
      }
    }

    // Next steps
    if (report.next_steps.length > 0) {
      console.log('');
      console.log('Next:');
      for (const step of report.next_steps) {
        console.log(`  - ${step}`);
      }
    }
  }

  // Exit code: 2 for runtime errors (missing DB, etc.)
  if (report.error) {
    process.exit(2);
  }

  // v0.6.2: Exit 0 regardless of whether suggestions were found.
  // Exit 1 is no longer used as "actionable suggestions exist" workflow signal.
  // Agents should check JSON output summary fields instead of exit code.
}

function getCardCount(pmemPath: string): number {
  try {
    const db = openMaintenanceDatabase(pmemPath);
    const row = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0 AND is_candidate = 0').get() as { count: number };
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * v0.7.6 fix U2: Distinguish three empty states for `update --suggest`.
 *
 * - `no_cards`: project has zero memory cards (genuine empty state, need to bootstrap).
 * - `no_affected_cards`: cards exist but no dirty flags were detected (or none
 *    mapped to any card). Memory may genuinely be up to date OR the change graph
 *    may not have surfaced anything yet — agents should verify with `pmem status`.
 * - `has_suggestions`: at least one blocking/warning/info suggestion was produced.
 *
 * Exported for unit testing in src/commands/update.test.ts.
 */
export function buildSuggestMessage(summary: SuggestSummary, cardCount: number): {
  message: string;
  state: 'no_cards' | 'no_affected_cards' | 'has_suggestions';
} {
  if (cardCount === 0) {
    return {
      message: 'No memory cards exist in this project yet. Run `pmem new <type> <title>` to create one, or `pmem init --guided` to bootstrap.',
      state: 'no_cards',
    };
  }
  if (summary.blocking === 0 && summary.warning === 0 && summary.info === 0) {
    return {
      message: 'No suggestions generated; no affected cards were detected. Run `pmem status --format json` to verify the change graph, and `pmem verify` to check freshness.',
      state: 'no_affected_cards',
    };
  }
  // Has at least one suggestion. Build a parts-list message.
  const parts: string[] = [];
  if (summary.blocking > 0) parts.push(`${summary.blocking} blocking memory consistency issue(s)`);
  if (summary.warning > 0) parts.push(`${summary.warning} current suggestion(s)`);
  if (summary.info > 0) parts.push(`${summary.info} informational item(s)`);
  return {
    message: parts.join(' and ') + '.',
    state: 'has_suggestions',
  };
}

function buildSuggestNextSteps(summary: SuggestSummary, cardCount: number): string[] {
  const steps: string[] = [];
  if (cardCount === 0) {
    steps.push('Create a module card with source_files pointing to your code');
    steps.push('Run `pmem rebuild` after creating cards');
    steps.push('Then try `pmem status` and `pmem mark-dirty --auto`');
  } else if (summary.blocking > 0 || summary.warning > 0) {
    steps.push('Update or confirm affected cards with pmem update --confirm -s "<summary>" -n "<next step>"');
    steps.push('Use --include-history to inspect older dirty flags.');
  } else if (summary.historical_hidden > 0) {
    steps.push('Use --include-history to inspect older dirty flags.');
    steps.push('Run `pmem verify` to check overall memory consistency.');
  } else {
    steps.push('Edit some source files, then run `pmem status` and `pmem mark-dirty --auto`');
    steps.push('Run `pmem verify` to check overall memory consistency');
  }
  return steps;
}

function applySuggestionAction(pmemPath: string, suggestionId: string): void {
  // Re-derive suggestions to find the matching one (with history included for full search)
  const report = generateSuggestions(pmemPath, true);

  // Flatten all groups into a single searchable list with generated IDs
  const flatList: Array<{ id: string; item: AggregatedSuggestion; action: string }> = [];
  let idx = 1;

  for (const item of report.groups.blocking_for_verify) {
    const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
    flatList.push({ id: `suggest-${idx}`, item, action });
    idx++;
  }
  for (const item of report.groups.current_suggestions) {
    const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
    flatList.push({ id: `suggest-${idx}`, item, action });
    idx++;
  }
  for (const item of report.groups.historical_dirty_flags) {
    const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
    flatList.push({ id: `suggest-${idx}`, item, action });
    idx++;
  }

  const match = flatList.find(s => s.id === suggestionId);
  if (!match) {
    console.log(`Suggestion "${suggestionId}" not found. Available suggestions:`);
    for (const s of flatList) {
      const filePart = s.item.matched_file ? `, ${s.item.matched_file}` : '';
      console.log(`  ${s.id}: ${s.action} ${s.item.target} (${s.item.reason}${filePart})`);
    }
    process.exit(2);
  }

  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    console.log('No SQLite database. Run pmem rebuild first.');
    process.exit(2);
  }

  const action = match.action;
  const target = match.item.target;
  const reason = match.item.reason;

  switch (action) {
    case 'update_card': {
      const db = openMaintenanceDatabase(pmemPath);
      // Mark the card's last_verified_at as expired
      db.prepare(
        "UPDATE cards SET last_verified_at = ? WHERE id = ?"
      ).run(new Date(0).toISOString(), target);
      closeDatabase();
      console.log(`Marked card "${target}" as needing verification.`);
      console.log(`  Reason: ${reason}`);
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

# Trace: ${reason}

## What Changed
${reason}

## Next
Continue as planned.
`);
      console.log(`Auto-created trace: traces/${today}-${traceNum}.md`);
      console.log(`  Reason: ${reason}`);

      // Resolve the associated dirty flags
      const db = openMaintenanceDatabase(pmemPath);
      const activeSession = getActiveSession(db);
      // Resolve all dirty flags matching this target+reason
      resolveDirtyFlags(db, 'card', target);
      insertUpdateLog(db, 'auto_trace', reason, activeSession?.id, [`trace.${today}-${traceNum}`], true);
      closeDatabase();
      break;
    }
    case 'update_state': {
      console.log(`Action required: ${reason}`);
      console.log('  Please run `pmem update --confirm` to update state.md.');
      break;
    }
    case 'update_next': {
      console.log(`Action required: ${reason}`);
      console.log('  Please run `pmem update --confirm --next "<next step>"` to update next.md.');
      break;
    }
    default: {
      console.log(`Unknown action "${action}" for suggestion ${suggestionId}.`);
      process.exit(2);
    }
  }

  process.exit(0);
}

// === v0.6.3: Edge Confirmation Management ===

function manageEdges(pmemPath: string, acceptRaw?: string, rejectRaw?: string): void {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    console.log('No SQLite database. Run `pmem rebuild` first.');
    process.exit(2);
  }

  const db = openMaintenanceDatabase(pmemPath);

  // Accept edges: upgrade from inferred to explicit
  if (acceptRaw) {
    const ids = parseEdgeIds(acceptRaw);
    if (ids.length > 0) {
      const changed = updateEdgeSource(db, ids, 'explicit', 1.0);
      console.log(`Accepted ${changed} edge(s): upgraded source to explicit, confidence to 1.0.`);
    }
  }

  // Reject edges: delete them
  if (rejectRaw) {
    const ids = parseEdgeIds(rejectRaw);
    if (ids.length > 0) {
      const deleted = deleteEdgesByIds(db, ids);
      console.log(`Rejected ${deleted} edge(s): deleted.`);
    }
  }

  closeDatabase();

  if (!acceptRaw && !rejectRaw) {
    // Show current inferred edges for review
    const db2 = openMaintenanceDatabase(pmemPath);
    const inferred = getInferredEdges(db2);
    if (inferred.length === 0) {
      console.log('No inferred edges to review.');
    } else {
      console.log(`Inferred edges (${inferred.length} total):\n`);
      const getCardTitle = (cid: string): string => {
        try {
          const row = db2.prepare('SELECT title FROM cards WHERE id = ?').get(cid) as { title: string } | undefined;
          return row?.title ?? cid;
        } catch { return cid; }
      };
      for (const edge of inferred) {
        console.log(`  [${edge.id}] ${edge.from_id} → ${edge.to_id}`);
        console.log(`      type: ${edge.type}, confidence: ${edge.confidence.toFixed(1)}, source: ${edge.source}`);
      }
      console.log('\nTo accept: pmem update --confirm --accept-edges <id1,id2>');
      console.log('To reject: pmem update --confirm --reject-edges <id1,id2>');
    }
    closeDatabase();
  }
}

function parseEdgeIds(raw: string): number[] {
  return raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);
}

// Add edge-related suggestions to the suggestion report.
// All inferred edges are surfaced (not just low-confidence), so the agent
// can review and decide which to accept / reject. Confidence and source are
// included as `sources[]` entries to drive the agent's judgment.
function enrichWithEdgeSuggestions(
  pmemPath: string,
  report: SuggestionReport,
): SuggestionReport {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return report;

  try {
    const db = openMaintenanceDatabase(pmemPath);
    const inferred = getInferredEdges(db);
    if (inferred.length === 0) return report;

    for (const edge of inferred) {
      const isLow = edge.confidence < 0.7;
      const reasonTag = isLow
        ? `inferred_edge_low_confidence: ${edge.from_id} → ${edge.to_id}`
        : `inferred_edge_review: ${edge.from_id} → ${edge.to_id}`;
      const detailReason = isLow
        ? `inferred_${edge.type}_confidence_${edge.confidence.toFixed(1)}`
        : `inferred_${edge.type}_confidence_${edge.confidence.toFixed(1)}_source_${edge.source}`;

      report.groups.current_suggestions.push({
        target: edge.from_id!,
        reason: reasonTag,
        matched_file: null,
        count: 1,
        severity: isLow ? 'warning' : 'info',
        blocks_verify: false,
        is_duplicate: false,
        is_historical: false,
        created_at_first: edge.created_at || new Date().toISOString(),
        created_at_last: edge.created_at || new Date().toISOString(),
        sources: [{
          scope: 'edge',
          target: `${edge.from_id} → ${edge.to_id}`,
          reason: detailReason,
          created_at: edge.created_at || new Date().toISOString(),
          session_id: null,
        }],
        edge_ids: edge.id !== undefined ? [edge.id] : [],
        edge_tuple: `${edge.from_id} → ${edge.to_id}`,
      });
    }

    report.summary.info += inferred.length;
    report.summary.affected_cards = new Set(
      inferred.map(e => e.from_id!)
    ).size + report.summary.affected_cards;

    return report;
  } catch {
    return report;
  }
}
