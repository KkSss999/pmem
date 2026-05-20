import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, readFile, writeFile, getFileMtime } from '../core/fs';
import { openDatabase, createSchema, closeDatabase } from '../core/db';
import type { CliFormat } from '../types';

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

  // Map to affected cards via SQLite paths table
  let db: any = null;
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      db = openDatabase(pmemPath);
      createSchema(db);
    } catch { /* DB may be locked or corrupt */ }
  }

  const affectedCards = new Set<string>();
  for (const change of changes) {
    if (db) {
      try {
        const rows = db.prepare(
          "SELECT card_id FROM paths WHERE ? LIKE '%' || path || '%'"
        ).all(change.path) as Array<{ card_id: string }>;
        for (const row of rows) {
          change.relatedCards.push(row.card_id);
          affectedCards.add(row.card_id);
        }
      } catch { /* ignore query errors */ }
    }
  }

  if (db) closeDatabase();

  // Output
  if (format === 'json') {
    console.log(JSON.stringify({
      checked_at: new Date().toISOString(),
      source,
      changes: changes.map(c => ({
        path: c.path,
        status: c.status,
        related_cards: c.relatedCards,
      })),
      affected_cards: [...affectedCards],
      suggested_action: affectedCards.size > 0 ? 'pmem mark-dirty --auto' : null,
    }, null, 2));
  } else {
    // compact output
    console.log(`Changed files (${changes.length}):`);
    for (const c of changes) {
      const related = c.relatedCards.length > 0 ? c.relatedCards.join(', ') : '(no related cards)';
      console.log(`  ${c.status} ${c.path} → related: ${related}`);
    }
    if (affectedCards.size > 0) {
      console.log(`\nAffected cards: ${[...affectedCards].join(', ')}`);
      console.log(`\nRun: pmem mark-dirty --auto`);
    }
  }

  // Exit code
  if (changes.length === 0) {
    process.exit(1);
  }
}

interface FileChange {
  path: string;
  status: string;
  relatedCards: string[];
}

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
      for (const line of output.trim().split('\n')) {
        if (!line.trim()) continue;
        const status = line.substring(0, 2).trim();
        let filePath = line.substring(3).trim();
        // Handle renamed files: "R old -> new"
        if (status.includes('R')) {
          const arrowIdx = filePath.indexOf(' -> ');
          if (arrowIdx > 0) filePath = filePath.substring(arrowIdx + 4);
        }
        // Skip ignored directories
        if (skipDirs.some(d => filePath.startsWith(d + '/') || filePath === d)) continue;
        changes.push({ path: filePath, status: status || 'M', relatedCards: [] });
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
