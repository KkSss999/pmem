import * as path from 'path';
import type Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { fileExists, getFileMtime, writeFile, isPathMatch, readFile } from '../fs';
import { openDatabase, createSchema, closeDatabase } from '../db';
import { parseGitStatusPorcelain } from '../git';
import { loadManifest, resolveConfig } from '../manifest';
import { parseFrontmatter } from '../yaml';
import type { Manifest } from '../../types';

interface FileChange {
  path: string;
  status: string;
  related_cards: Array<{ card_id: string; match_type: string }>;
}

interface AffectedCard {
  card_id: string;
  match_type: 'exact' | 'directory' | 'graph_neighbor' | 'new_card' | 'modified_card';
  matched_file?: string;
  matched_dir?: string;
  via_card?: string;
}

const MATCH_PRIORITY: Record<string, number> = {
  exact: 3,
  directory: 2,
  graph_neighbor: 1,
  new_card: 3,
  modified_card: 3,
};

export interface StatusResult {
  checked_at: string;
  source: 'git' | 'mtime';
  changes: Array<{
    path: string;
    status: string;
    related_cards: Array<{ card_id: string; match_type: string }>;
  }>;
  affected_cards: Array<{
    id: string;
    card_id: string;
    reason: 'source_file_changed' | 'new_card' | 'modified_card';
    match_type?: string;
    matched_file?: string;
    matched_dir?: string;
    via_card?: string;
  }>;
  needs_rebuild: boolean;
  state: 'no_changes' | 'source_changes_only' | 'memory_changes_detected' | 'mixed';
  suggested_action: string | null;
}

export function statusQuery(pmemPath: string, options?: {
  since?: string;
  db?: Database.Database;
}): StatusResult {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(pmemPath)) {
    throw new Error('No .pmem directory found. Run `pmem init` first.');
  }

  const source = detectChangesFrom();
  const changes = getChangedFiles(pmemPath, cwd, options?.since);

  const affectedCards = new Map<string, AffectedCard>();

  if (fileExists(dbPath)) {
    const db = options?.db ?? openDatabase(pmemPath);
    if (!options?.db) createSchema(db);

    // Pass 1: Exact path matching
    try {
      const allPaths = db.prepare(
        "SELECT card_id, path FROM paths"
      ).all() as Array<{ card_id: string; path: string }>;

      for (const change of changes) {
        for (const p of allPaths) {
          if (isPathMatch(change.path, p.path)) {
            change.related_cards.push({ card_id: p.card_id, match_type: 'exact' });
            upsertAffectedCard(affectedCards, {
              card_id: p.card_id,
              match_type: 'exact',
              matched_file: change.path,
            });
          }
        }
      }
    } catch { /* ignore query errors */ }

    // Pass 2: Directory-level fuzzy matching
    try {
      const dirSet = new Set<string>();
      for (const change of changes) {
        const dir = path.dirname(change.path);
        if (dir && dir !== '.') {
          dirSet.add(dir);
        }
      }
      for (const dir of dirSet) {
        const dirPattern = dir + '/%';
        const dirRows = db.prepare(
          "SELECT card_id, path FROM paths WHERE path LIKE ?"
        ).all(dirPattern) as Array<{ card_id: string; path: string }>;
        for (const row of dirRows) {
          upsertAffectedCard(affectedCards, {
            card_id: row.card_id,
            match_type: 'directory',
            matched_dir: dir + '/',
          });
        }
      }
    } catch { /* ignore query errors */ }

    // Pass 3: Graph neighbor expansion (one-hop)
    if (affectedCards.size > 0) {
      const affectedCardIds = [...affectedCards.keys()];
      const placeholders = affectedCardIds.map(() => '?').join(',');
      try {
        const edgeRows = db.prepare(
          `SELECT from_id, to_id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`
        ).all(...affectedCardIds, ...affectedCardIds) as Array<{ from_id: string; to_id: string }>;

        for (const edge of edgeRows) {
          if (affectedCards.has(edge.from_id) && !affectedCards.has(edge.to_id)) {
            upsertAffectedCard(affectedCards, {
              card_id: edge.to_id,
              match_type: 'graph_neighbor',
              via_card: edge.from_id,
            });
          }
          if (affectedCards.has(edge.to_id) && !affectedCards.has(edge.from_id)) {
            upsertAffectedCard(affectedCards, {
              card_id: edge.from_id,
              match_type: 'graph_neighbor',
              via_card: edge.to_id,
            });
          }
        }
      } catch { /* ignore query errors */ }
    }
  }

  // === Pass 4: Detect new/modified markdown files under .pmem directly ===
  // This catches cards whose frontmatter id is not yet in the SQLite paths table
  // (i.e., before a pmem rebuild).
  const existingCardIds = collectExistingCardIds(dbPath, options?.db);
  const needsRebuild = detectMemoryCardChanges(cwd, changes, affectedCards, existingCardIds);

  const affectedCardsList = [...affectedCards.values()];
  const state = deriveState(changes.length, affectedCardsList, needsRebuild);

  return {
    checked_at: new Date().toISOString(),
    source,
    changes: changes.map(c => ({
      path: c.path,
      status: c.status,
      related_cards: c.related_cards,
    })),
    affected_cards: affectedCardsList.map(ac => {
      const obj: Record<string, unknown> = {
        id: ac.card_id,
        card_id: ac.card_id,
        reason: deriveReason(ac.match_type),
        match_type: ac.match_type,
      };
      if (ac.matched_file) obj.matched_file = ac.matched_file;
      if (ac.matched_dir) obj.matched_dir = ac.matched_dir;
      if (ac.via_card) obj.via_card = ac.via_card;
      return obj as any;
    }),
    needs_rebuild: needsRebuild,
    state,
    suggested_action: buildSuggestedAction(affectedCards.size, needsRebuild, changes.length),
  };
}

function deriveReason(matchType: AffectedCard['match_type']): 'source_file_changed' | 'new_card' | 'modified_card' {
  if (matchType === 'new_card') return 'new_card';
  if (matchType === 'modified_card') return 'modified_card';
  return 'source_file_changed';
}

function deriveState(
  changeCount: number,
  affectedCards: AffectedCard[],
  needsRebuild: boolean,
): StatusResult['state'] {
  if (changeCount === 0) return 'no_changes';
  const hasMemoryChange = affectedCards.some(
    (ac) => ac.match_type === 'new_card' || ac.match_type === 'modified_card'
  );
  const hasSourceChange = affectedCards.some(
    (ac) => ac.match_type === 'exact' || ac.match_type === 'directory' || ac.match_type === 'graph_neighbor'
  );
  if (needsRebuild || hasMemoryChange) {
    return hasSourceChange ? 'mixed' : 'memory_changes_detected';
  }
  if (hasSourceChange || changeCount > 0) return 'source_changes_only';
  return 'no_changes';
}

function buildSuggestedAction(affectedCount: number, needsRebuild: boolean, changeCount = 0): string | null {
  if (needsRebuild) return 'pmem rebuild';
  if (affectedCount > 0) return 'pmem mark-dirty --auto';
  if (changeCount > 0) return 'review source changes; no related memory cards found';
  return null;
}

/**
 * Collect the set of card IDs already present in the SQLite `paths` table.
 * Used to distinguish "new_card" (frontmatter id not in DB) from
 * "modified_card" (frontmatter id already in DB but content changed).
 * Returns an empty set if the DB is missing or unreadable.
 */
function collectExistingCardIds(dbPath: string, existingDb?: Database.Database): Set<string> {
  const ids = new Set<string>();
  if (!fileExists(dbPath)) return ids;
  try {
    const db = existingDb ?? openDatabase(path.dirname(dbPath));
    try {
      const rows = db.prepare('SELECT DISTINCT card_id FROM paths').all() as Array<{ card_id: string }>;
      for (const row of rows) {
        if (row.card_id) ids.add(row.card_id);
      }
    } finally {
      if (!existingDb) closeDatabase();
    }
  } catch { /* ignore — fall back to empty set */ }
  return ids;
}

/**
 * Inspect markdown files under .pmem inside the change list and surface their
 * frontmatter id directly, so callers (CLI / MCP / agents) don't have to wait
 * for a pmem rebuild to see new cards in affected_cards.
 *
 * Returns true if at least one .pmem markdown file was added or modified —
 * caller should set needs_rebuild = true in that case.
 */
function detectMemoryCardChanges(
  cwd: string,
  changes: FileChange[],
  affectedCards: Map<string, AffectedCard>,
  existingCardIds: Set<string>,
): boolean {
  let needsRebuild = false;

  for (const change of changes) {
    // Only inspect markdown files under .pmem/
    if (!change.path.startsWith('.pmem/')) continue;
    if (!change.path.endsWith('.md')) continue;
    // Skip non-card artifacts (skills / candidates / summaries / indexes / db).
    if (change.path.startsWith('.pmem/skills/')) continue;
    if (change.path.startsWith('.pmem/candidates/')) continue;
    if (change.path.startsWith('.pmem/summaries/')) continue;
    if (change.path.startsWith('.pmem/indexes/')) continue;

    const status = (change.status || '').toUpperCase();
    // Treat anything that is not deletion as relevant for rebuild:
    //   'A' / '??' (added), 'M' (modified), 'R' (renamed), 'C' (copied), etc.
    const isAddedOrModified =
      status === 'A' || status === '??' || status === 'M' ||
      status === 'R' || status === 'C' || status === 'AM';
    if (!isAddedOrModified) continue;

    const absPath = path.join(cwd, change.path);
    const content = readFile(absPath);
    if (content === null) continue;

    const fm = parseFrontmatter(content);
    if (!fm) continue;
    const rawId = fm.data.id;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) continue;

    needsRebuild = true;
    // Determine new vs modified:
    //   - Git explicit 'A' / '??' (untracked) => new_card.
    //   - Git explicit 'M' (modified tracked file) => modified_card,
    //     because the file WAS tracked before this change.
    //   - For mtime-mode (no git signal) or other ambiguous statuses,
    //     consult the SQLite paths table:
    //       - id present in DB => modified_card
    //       - id absent          => new_card
    let matchType: AffectedCard['match_type'];
    if (status === 'A' || status === '??') {
      matchType = 'new_card';
    } else if (status === 'M' || status === 'AM') {
      matchType = 'modified_card';
    } else {
      // R / C / mtime-mode / unknown — fall back to DB lookup.
      matchType = existingCardIds.has(id) ? 'modified_card' : 'new_card';
    }
    change.related_cards.push({ card_id: id, match_type: matchType });
    upsertAffectedCard(affectedCards, {
      card_id: id,
      match_type: matchType,
      matched_file: change.path,
    });
  }

  return needsRebuild;
}

function upsertAffectedCard(map: Map<string, AffectedCard>, card: AffectedCard): void {
  const existing = map.get(card.card_id);
  if (!existing || MATCH_PRIORITY[card.match_type] > MATCH_PRIORITY[existing.match_type]) {
    map.set(card.card_id, card);
  }
}

function detectChangesFrom(): 'git' | 'mtime' {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return 'git';
  } catch {
    return 'mtime';
  }
}

function getChangedFiles(pmemPath: string, cwd: string, since?: string): FileChange[] {
  const changes: FileChange[] = [];
  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest as Manifest) : null;

  const userSkipDirs = (manifest as any)?.change_detection?.skip_dirs || [];
  const systemSkips = [
    'node_modules', '.git', 'dist', 'build', '.claude',
    '.pmem/pmem.db', '.pmem/indexes', '.pmem/.lock',
    '.pmem/skills', '.pmem/candidates', '.pmem/summaries',
    '.pmem/.last-status'
  ];
  const skipDirs = manifest && (manifest as any).schema
    ? Array.from(new Set([...userSkipDirs, ...systemSkips]))
    : ['node_modules', '.git', '.pmem', 'dist', 'build', '.claude'];

  try {
    const source = detectChangesFrom();
    if (source === 'git') {
      const output = execSync('git status --porcelain -u', { cwd, encoding: 'utf-8', timeout: 5000 });
      for (const change of parseGitStatusPorcelain(output)) {
        if (skipDirs.some(d => change.path.startsWith(d + '/') || change.path === d)) continue;
        changes.push({ path: change.path, status: change.status || 'M', related_cards: [] });
      }
      return changes;
    }
  } catch { /* fall through to mtime */ }

  // Mtime-based fallback
  const lastStatusFile = path.join(cwd, '.pmem', '.last-status');
  const lastCheck = since ? new Date(since).getTime() : (getFileMtime(lastStatusFile) || 0);

  const defaultScanDirs = ['src', 'lib', 'app', 'tests'];
  const mtimeScanDirs = (manifest as any)?.change_detection?.mtime_scan_dirs || defaultScanDirs;

  for (const dir of mtimeScanDirs) {
    const dirPath = path.join(cwd, dir);
    if (!fileExists(dirPath)) continue;
    scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
  }

  if (config) {
    for (const dir of Object.values(config.type_dirs)) {
      const dirPath = path.join(cwd, '.pmem', dir);
      if (!fileExists(dirPath)) continue;
      scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
    }
  }

  writeFile(lastStatusFile, new Date().toISOString());

  return changes;
}

function scanDirMtime(dirPath: string, cwd: string, since: number, skipDirs: string[], changes: FileChange[]): void {
  const fs = require('fs');
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(cwd, fullPath);
      if (skipDirs.some(d => relPath.startsWith(d + '/') || relPath === d)) continue;

      if (entry.isDirectory()) {
        scanDirMtime(fullPath, cwd, since, skipDirs, changes);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > since) {
            changes.push({ path: relPath, status: 'M', related_cards: [] });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
}
