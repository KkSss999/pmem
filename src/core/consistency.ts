import * as path from 'path';
import { statSync } from 'fs';
import { fileExists } from './fs';
import { openDatabase } from './db';
import type { ConsistencyIssue, CardRow } from '../types';

/**
 * Check for stale memory: cards whose source_files have been modified
 * after the card was last updated or verified.
 *
 * Shared between verify.ts and update.ts so that verify/suggest
 * semantics stay aligned.
 */
export function checkStaleMemory(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(dbPath)) {
    return [];
  }

  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(pmemPath);
  } catch {
    return [];
  }

  const issues: ConsistencyIssue[] = [];

  try {
    const cards = db.prepare(
      'SELECT * FROM cards WHERE is_deleted = 0'
    ).all() as CardRow[];

    for (const card of cards) {
      if (card.type === 'trace') continue;
      const sourceFiles = db.prepare(
        "SELECT p.path FROM paths p WHERE p.card_id = ? AND p.relation = 'source_file'"
      ).all(card.id) as Array<{ path: string }>;

      const t1 = card.updated_at ? new Date(card.updated_at).getTime() : 0;
      const t2 = card.last_verified_at ? new Date(card.last_verified_at).getTime() : 0;
      const cardUpdatedMs = Math.max(t1, t2);
      if (cardUpdatedMs === 0) continue;

      for (const sourceFile of sourceFiles) {
        // Skip .pmem/ self-references: pmem update --confirm rewrites
        // manifest.yml / next.md / state.md / index.md, which would
        // immediately trigger false-positive stale_memory on the next
        // verify for any card whose source_files list .pmem/ entries.
        if (sourceFile.path.startsWith('.pmem/') || sourceFile.path === '.pmem') continue;

        const absPath = path.join(cwd, sourceFile.path);
        if (!fileExists(absPath)) continue;
        try {
          const sourceStat = statSync(absPath);
          if (sourceStat.mtimeMs > cardUpdatedMs) {
            issues.push({
              type: 'stale_memory',
              severity: 'blocking',
              card_id: card.id,
              file_path: sourceFile.path,
              message: `${card.id} may be stale — ${sourceFile.path} modified after last card update`,
            });
          }
        } catch {
          // skip files that can't be stat'd
        }
      }
    }
  } finally {
    // Don't close the DB — it may be reused by the caller
  }

  return issues;
}
