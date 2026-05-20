import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, readFile, writeFile, getFileMtime } from '../core/fs';
import { openDatabase, createSchema, closeDatabase } from '../core/db';
import { parseGitStatusPorcelain } from '../core/git';
import type { CliFormat } from '../types';

// === Data structures ===

interface AffectedCard {
  card_id: string;
  match_type: 'exact' | 'directory' | 'graph_neighbor';
  matched_file?: string;
  matched_dir?: string;
  via_card?: string;
}

interface RelatedCardRef {
  card_id: string;
  match_type: string;
}

interface FileChange {
  path: string;
  status: string;
  relatedCards: RelatedCardRef[];
}

const MATCH_PRIORITY: Record<string, number> = {
  exact: 3,
  directory: 2,
  graph_neighbor: 1,
};

// === Helper ===

function upsertAffectedCard(map: Map<string, AffectedCard>, card: AffectedCard): void {
  const existing = map.get(card.card_id);
  if (!existing || MATCH_PRIORITY[card.match_type] > MATCH_PRIORITY[existing.match_type]) {
    map.set(card.card_id, card);
  }
}

function formatAffectedCardDetail(ac: AffectedCard): string {
  switch (ac.match_type) {
    case 'exact':
      return `exact: ${ac.matched_file}`;
    case 'directory':
      return `directory: ${ac.matched_dir}`;
    case 'graph_neighbor':
      return `graph_neighbor via ${ac.via_card}`;
    default:
      return ac.match_type;
  }
}

// === Main command ===

export function statusCommand(options: { since?: string; format?: string }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');
  const format = (options.format || 'compact') as CliFormat;

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  // Detect changes
  const source = detectChangesFrom();
  const changes = getChangedFiles(cwd, options.since);

  // Open database
  let db: any = null;
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      db = openDatabase(pmemPath);
      createSchema(db);
    } catch { /* DB may be locked or corrupt */ }
  }

  const affectedCards = new Map<string, AffectedCard>();

  // === Pass 1: Exact path matching (per file) ===
  for (const change of changes) {
    if (!db) continue;
    try {
      const rows = db.prepare(
        "SELECT card_id, path FROM paths WHERE ? LIKE '%' || path || '%'"
      ).all(change.path) as Array<{ card_id: string; path: string }>;
      for (const row of rows) {
        change.relatedCards.push({ card_id: row.card_id, match_type: 'exact' });
        upsertAffectedCard(affectedCards, {
          card_id: row.card_id,
          match_type: 'exact',
          matched_file: change.path,
        });
      }
    } catch { /* ignore query errors */ }
  }

  // === Pass 2: Directory-level fuzzy matching ===
  // Collect unique directories from changed files, then query each once
  if (db) {
    const dirSet = new Set<string>();
    for (const change of changes) {
      const dir = path.dirname(change.path);
      if (dir && dir !== '.') {
        dirSet.add(dir);
      }
    }
    for (const dir of dirSet) {
      try {
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
      } catch { /* ignore query errors */ }
    }
  }

  // === Pass 3: Graph neighbor expansion (one-hop) ===
  if (db && affectedCards.size > 0) {
    const affectedCardIds = [...affectedCards.keys()];
    const placeholders = affectedCardIds.map(() => '?').join(',');
    try {
      const edgeRows = db.prepare(
        `SELECT from_id, to_id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`
      ).all(...affectedCardIds, ...affectedCardIds) as Array<{ from_id: string; to_id: string }>;

      for (const edge of edgeRows) {
        // from_id is affected, to_id is the neighbor
        if (affectedCards.has(edge.from_id) && !affectedCards.has(edge.to_id)) {
          upsertAffectedCard(affectedCards, {
            card_id: edge.to_id,
            match_type: 'graph_neighbor',
            via_card: edge.from_id,
          });
        }
        // to_id is affected, from_id is the neighbor
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

  if (db) closeDatabase();

  // === Output ===
  const affectedCardsList = [...affectedCards.values()];

  if (format === 'json') {
    console.log(JSON.stringify({
      checked_at: new Date().toISOString(),
      source,
      changes: changes.map(c => ({
        path: c.path,
        status: c.status,
        related_cards: c.relatedCards.map(rc => ({
          card_id: rc.card_id,
          match_type: rc.match_type,
        })),
      })),
      affected_cards: affectedCardsList.map(ac => {
        const obj: Record<string, unknown> = { card_id: ac.card_id, match_type: ac.match_type };
        if (ac.matched_file) obj.matched_file = ac.matched_file;
        if (ac.matched_dir) obj.matched_dir = ac.matched_dir;
        if (ac.via_card) obj.via_card = ac.via_card;
        return obj;
      }),
      suggested_action: affectedCards.size > 0 ? 'pmem mark-dirty --auto' : null,
    }, null, 2));
  } else {
    // compact output
    console.log(`Changed files (${changes.length}):`);
    for (const c of changes) {
      const related = c.relatedCards.length > 0
        ? c.relatedCards.map(rc => `${rc.card_id} (${rc.match_type})`).join(', ')
        : '(no related cards)';
      console.log(`  ${c.status} ${c.path} → related: ${related}`);
    }
    if (affectedCards.size > 0) {
      console.log(`\nAffected cards (${affectedCards.size}):`);
      for (const ac of affectedCardsList) {
        console.log(`  ${ac.card_id} (${formatAffectedCardDetail(ac)})`);
      }
      console.log(`\nRun: pmem mark-dirty --auto`);
    }
  }

  // Exit code
  if (changes.length === 0) {
    process.exit(1);
  }
}

// === Change detection ===

function detectChangesFrom(): string {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return 'git';
  } catch {
    return 'mtime';
  }
}

function getChangedFiles(cwd: string, since?: string): FileChange[] {
  const changes: FileChange[] = [];
  const skipDirs = ['node_modules', '.git', '.pmem', 'dist', 'build', '.claude'];

  try {
    const source = detectChangesFrom();
    if (source === 'git') {
      const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 });
      for (const change of parseGitStatusPorcelain(output)) {
        // Skip ignored directories
        if (skipDirs.some(d => change.path.startsWith(d + '/') || change.path === d)) continue;
        changes.push({ path: change.path, status: change.status || 'M', relatedCards: [] });
      }
      return changes;
    }
  } catch { /* fall through to mtime */ }

  // Mtime-based fallback
  const lastStatusFile = path.join(cwd, '.pmem', '.last-status');
  const lastCheck = since ? new Date(since).getTime() : (getFileMtime(lastStatusFile) || 0);

  // Simple mtime scan of common source dirs
  for (const dir of ['src', 'lib', 'app', 'tests']) {
    const dirPath = path.join(cwd, dir);
    if (!fileExists(dirPath)) continue;
    scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
  }

  // Update .last-status
  writeFile(lastStatusFile, new Date().toISOString());

  return changes;
}

function scanDirMtime(dirPath: string, cwd: string, since: number, skipDirs: string[], changes: FileChange[]): void {
  const fs = require('fs');
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        scanDirMtime(fullPath, cwd, since, skipDirs, changes);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > since) {
            const relPath = path.relative(cwd, fullPath);
            changes.push({ path: relPath, status: 'M', relatedCards: [] });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
}
