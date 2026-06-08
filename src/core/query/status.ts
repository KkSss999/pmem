import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, getFileMtime, writeFile, isPathMatch } from '../fs';
import { openDatabase, createSchema } from '../db';
import { parseGitStatusPorcelain } from '../git';
import { loadManifest, resolveConfig } from '../manifest';
import type { Manifest } from '../../types';

interface FileChange {
  path: string;
  status: string;
  related_cards: Array<{ card_id: string; match_type: string }>;
}

interface AffectedCard {
  card_id: string;
  match_type: 'exact' | 'directory' | 'graph_neighbor';
  matched_file?: string;
  matched_dir?: string;
  via_card?: string;
}

const MATCH_PRIORITY: Record<string, number> = {
  exact: 3,
  directory: 2,
  graph_neighbor: 1,
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
    card_id: string;
    match_type: string;
    matched_file?: string;
    matched_dir?: string;
    via_card?: string;
  }>;
  suggested_action: string | null;
}

export function statusQuery(pmemPath: string, options?: {
  since?: string;
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
    const db = openDatabase(pmemPath);
    createSchema(db);

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

  const affectedCardsList = [...affectedCards.values()];

  return {
    checked_at: new Date().toISOString(),
    source,
    changes: changes.map(c => ({
      path: c.path,
      status: c.status,
      related_cards: c.related_cards,
    })),
    affected_cards: affectedCardsList.map(ac => {
      const obj: Record<string, unknown> = { card_id: ac.card_id, match_type: ac.match_type };
      if (ac.matched_file) obj.matched_file = ac.matched_file;
      if (ac.matched_dir) obj.matched_dir = ac.matched_dir;
      if (ac.via_card) obj.via_card = ac.via_card;
      return obj as any;
    }),
    suggested_action: affectedCards.size > 0 ? 'pmem mark-dirty --auto' : null,
  };
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
      const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 });
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
