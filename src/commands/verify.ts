import * as path from 'path';
import { statSync } from 'fs';
import { readFile, fileExists } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openDatabase, createSchema } from '../core/db';
import { computeHash, tokenCount } from '../core/hash';
import type { VerifyIssue, VerifyResult, CardRow, EdgeRow } from '../types';
import { rebuildCommand } from './rebuild';

const PMEM_DIR = '.pmem';

export function verifyCommand(options: { fix?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const issues: VerifyIssue[] = [];

  // 1. Check manifest exists
  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    issues.push({
      severity: 'error',
      type: 'missing_manifest',
      message: '.pmem/manifest.yml not found or invalid.',
      fix: 'Run: pmem init',
    });
  }

  // 2. Check SQLite DB exists
  const dbPath = path.join(pmemPath, 'pmem.db');
  const dbExists = fileExists(dbPath);
  let db: ReturnType<typeof openDatabase> | null = null;

  if (!dbExists) {
    issues.push({
      severity: 'warning',
      type: 'missing_database',
      message: '.pmem/pmem.db not found.',
      fix: 'Run: pmem rebuild',
    });
  } else {
    db = openDatabase(pmemPath);
    createSchema(db);
  }

  if (manifest) {
    // 3. Check schema version
    const currentSchema = manifest.pmem?.schema_version;
    if (!currentSchema) {
      issues.push({
        severity: 'warning',
        type: 'missing_schema_version',
        message: 'Manifest is missing pmem.schema_version.',
        fix: 'Run: pmem migrate --to 0.3',
      });
    } else if (currentSchema < '0.3') {
      issues.push({
        severity: 'warning',
        type: 'old_schema_version',
        message: `Project schema version is ${currentSchema}. Current CLI supports 0.3.`,
        fix: 'Run: pmem migrate --to 0.3',
      });
    } else if (currentSchema > '0.3') {
      issues.push({
        severity: 'error',
        type: 'newer_schema_version',
        message: `Project schema version is ${currentSchema}. Current CLI only supports up to 0.3.`,
        fix: 'Please upgrade pmem CLI to a newer version.',
      });
    }

    if (db) {
      const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];

      // 4. Hash consistency — compare DB file_hash against actual .md file content
      for (const card of cards) {
        const cardFilePath = path.join(cwd, card.file_path);
        if (!fileExists(cardFilePath)) {
          issues.push({
            severity: 'warning',
            type: 'missing_card_file',
            message: `Card "${card.id}" references missing file: ${card.file_path}`,
            fix: 'Run: pmem rebuild',
          });
          continue;
        }

        const content = readFile(cardFilePath);
        if (!content) continue;

        const currentFileHash = computeHash(content);
        if (currentFileHash !== card.file_hash) {
          issues.push({
            severity: 'warning',
            type: 'stale_index',
            message: `Card "${card.id}" file hash mismatch (stored: ${card.file_hash}, current: ${currentFileHash}).`,
            fix: 'Run: pmem rebuild',
          });
        }
      }

      // 5. Orphan edges — edges referencing non-existent card IDs
      const orphanFrom = db.prepare(
        'SELECT e.* FROM edges e LEFT JOIN cards c ON e.from_id = c.id WHERE c.id IS NULL'
      ).all() as EdgeRow[];

      const orphanTo = db.prepare(
        'SELECT e.* FROM edges e LEFT JOIN cards c ON e.to_id = c.id WHERE c.id IS NULL'
      ).all() as EdgeRow[];

      const orphanEdgeSet = new Map<number, EdgeRow>();
      for (const e of orphanFrom) {
        if (e.id !== undefined) orphanEdgeSet.set(e.id, e);
      }
      for (const e of orphanTo) {
        if (e.id !== undefined && !orphanEdgeSet.has(e.id)) orphanEdgeSet.set(e.id, e);
      }

      if (orphanEdgeSet.size > 0) {
        issues.push({
          severity: 'warning',
          type: 'orphan_edges',
          message: `${orphanEdgeSet.size} edge(s) reference non-existent card IDs.`,
          fix: 'Run: pmem rebuild',
        });
      }

      // 6. Card policy checks
      if (manifest.card_policy) {
        const policy = manifest.card_policy;

        // 6a. ID naming pattern
        const idRegex = new RegExp(policy.id_pattern);
        for (const card of cards) {
          if (!idRegex.test(card.id)) {
            issues.push({
              severity: 'warning',
              type: 'card_id_violation',
              message: `Card "${card.id}" does not match naming pattern.`,
              fix: `Rename card ID to match: ${policy.id_pattern}`,
            });
          }
        }

        // 6b. Token count limits — read files and estimate tokens
        for (const card of cards) {
          const filePath = path.join(cwd, card.file_path);
          const content = readFile(filePath);
          if (content) {
            const estimatedTokens = tokenCount(content);
            const maxForType = policy.max_tokens[card.type];
            if (maxForType && estimatedTokens > maxForType) {
              issues.push({
                severity: 'warning',
                type: 'card_too_large',
                message: `Card "${card.id}" is ~${estimatedTokens} tokens (max for ${card.type}: ${maxForType}).`,
                fix: 'Consider splitting this card or run `pmem distill --suggest-splits`.',
              });
            }
          }
        }

        // 6c. Relation count threshold
        for (const card of cards) {
          const { count: relatedEdgeCount } = db.prepare(
            'SELECT COUNT(*) as count FROM edges WHERE from_id = ? OR to_id = ?'
          ).get(card.id, card.id) as { count: number };

          if (relatedEdgeCount > policy.warn_when_related_count_gt) {
            issues.push({
              severity: 'warning',
              type: 'too_many_relations',
              message: `Card "${card.id}" has ${relatedEdgeCount} relations (threshold: ${policy.warn_when_related_count_gt}).`,
              fix: 'Review whether all relations are necessary.',
            });
          }
        }
      }

      // 9. Stale memory: source files newer than card update time
      for (const card of cards) {
        const sourceFiles = db.prepare(
          "SELECT p.path FROM paths p WHERE p.card_id = ? AND p.relation = 'source_file'"
        ).all(card.id) as Array<{ path: string }>;

        const cardUpdated = card.updated_at || card.last_verified_at;
        if (!cardUpdated) continue;

        const cardUpdatedMs = new Date(cardUpdated).getTime();

        for (const sourceFile of sourceFiles) {
          const absPath = path.join(cwd, sourceFile.path);
          if (!fileExists(absPath)) continue;
          try {
            const sourceStat = statSync(absPath);
            if (sourceStat.mtimeMs > cardUpdatedMs) {
              issues.push({
                severity: 'warning',
                type: 'stale_memory',
                message: `${card.id} may be stale — ${sourceFile.path} modified after last card update`,
                fix: `Run: pmem update --confirm to update ${card.id}.`,
              });
            }
          } catch {
            // skip files that can't be stat'd
          }
        }
      }
    }

    // 7. Check AGENTS.md exists
    if (!fileExists(path.join(cwd, 'AGENTS.md'))) {
      issues.push({
        severity: 'warning',
        type: 'missing_agents',
        message: 'AGENTS.md not found in project root.',
        fix: 'Run: pmem init',
      });
    }

    // 8. Check memory_status.dirty
    if (manifest.memory_status?.dirty) {
      issues.push({
        severity: 'warning',
        type: 'memory_dirty',
        message: `Memory is marked dirty since ${manifest.memory_status.dirty_since || 'unknown'}. Reason: ${manifest.memory_status.dirty_reason || 'unknown'}.`,
        fix: 'Run: pmem update --auto (to detect changes) or pmem update --confirm (to record updates).',
      });
    }
  }

  // Build result
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const passed = errors.length === 0;
  const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 5);

  const result: VerifyResult = { passed, score, issues };

  // Output
  if (passed && warnings.length === 0) {
    console.log(`✓ Memory verification passed.`);
    console.log(`  Score: ${score}/100`);
    return;
  }

  console.log(`Memory Verify Result: ${passed ? 'Warnings found' : 'Failed'}`);
  console.log(`Score: ${score}/100`);
  console.log('');

  for (const issue of issues) {
    const icon = issue.severity === 'error' ? '✗' : '⚠';
    console.log(`${icon} [${issue.type}] ${issue.message}`);
    console.log(`  Fix: ${issue.fix}`);
    console.log('');
  }

  // Auto-fix if requested
  if (options.fix) {
    const fixableIssue = issues.find(i =>
      i.type === 'stale_index' ||
      i.type === 'missing_database' ||
      i.type === 'missing_card_file' ||
      i.type === 'orphan_edges'
    );
    if (fixableIssue) {
      console.log('Auto-fixing: rebuilding indexes...');
      rebuildCommand();
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');
  if (hasErrors) process.exit(2);
  if (hasWarnings) process.exit(1);
  process.exit(0);
}
