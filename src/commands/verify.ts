import * as path from 'path';
import { statSync } from 'fs';
import { readFile, fileExists, getLockStatus, breakLock, acquireLock, releaseLock } from '../core/fs';
import { loadManifest, resolveConfig, renderIdPattern } from '../core/manifest';
import { openDatabase, createSchema } from '../core/db';
import { computeHash, tokenCount } from '../core/hash';
import { checkStaleMemory, checkDocSync, verifyMemory, checkModuleContracts } from '../core/consistency';
import type { VerifyIssue, VerifyResult, CardRow, EdgeRow } from '../types';
import { rebuildCommand } from './rebuild';
import { parseFrontmatter } from '../core/yaml';
import { getDistillUrgency } from '../runtime/policy';

const PMEM_DIR = '.pmem';

export function verifyCommand(options: { fix?: boolean; fixLocks?: boolean; fixStale?: boolean; relaxed?: boolean; noExit?: boolean; cwd?: string }): void {
  const cwd = options.cwd ?? process.cwd();
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

  // 2b. Lock status check (read-only)
  //
  // v0.7.6 FIX-1 (issue #9): restructured the lock block. The old code
  // emitted an `active_lock` warning here based purely on lock presence.
  // The new flow instead tries to *acquire* the lock with a short timeout
  // (see below) — if it cannot, another process is rebuilding right now
  // and we defer stale-index checks instead of producing a transient
  // `stale_index` warning. The `stale_lock` / `stale_lock_cleaned`
  // classification still exists so users can still detect + clean
  // crashed pmem processes that left a lock behind.
  const lockPath = path.join(pmemPath, '.lock');
  const lockStatus = getLockStatus(lockPath);
  if (lockStatus.exists && lockStatus.stale) {
    const ageSec = lockStatus.age !== null ? Math.round(lockStatus.age / 1000) : '?';
    if (options.fixLocks) {
      breakLock(lockPath);
      issues.push({
        severity: 'warning',
        type: 'stale_lock_cleaned',
        message: `Stale lock at .pmem/.lock (age: ${ageSec}s) was cleaned.`,
        fix: 'Lock has been removed. You can now run pmem commands.',
      });
    } else {
      issues.push({
        severity: 'warning',
        type: 'stale_lock',
        message: `Stale lock detected at .pmem/.lock (age: ${ageSec}s).`,
        fix: 'Run: pmem verify --fix-locks (to clean stale lock)\n       Or: pmem doctor (to diagnose lock status)',
      });
    }
  }

  // v0.7.6 FIX-1 (issue #9): try to acquire the lock with a short timeout
  // so a concurrent `pmem rebuild` cannot tear the SQLite index out from
  // under us while we read it (which would produce a transient `stale_index`
  // warning that disappears on the next verify). If we cannot acquire the
  // lock, surface a single info-level `active_lock` note and skip the
  // freshness checks entirely.
  const lockAcquired = acquireLock(lockPath, 500);
  if (!lockAcquired) {
    const ageSec = lockStatus.age !== null ? Math.round(lockStatus.age / 1000) : '?';
    issues.push({
      severity: 'info',
      type: 'active_lock',
      message: `Active lock at .pmem/.lock (age: ${ageSec}s). Another pmem process is running — deferring index freshness checks.`,
      fix: 'Wait for the other pmem process to finish, then re-run: pmem verify',
    });

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const infos = issues.filter(i => i.severity === 'info');
    const passed = errors.length === 0;
    const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 5);
    const result: VerifyResult = { passed, score, issues };

    if (passed && warnings.length === 0) {
      console.log(`Memory Verify Result: clean (index checks deferred).`);
      console.log(`Score: ${score}/100`);
      if (infos.length > 0) {
        console.log('');
        console.log('Informational Notes:');
        for (const issue of infos) {
          console.log(`ℹ [${issue.type}] ${issue.message}`);
        }
      }
      return;
    }

    console.log(`Memory Verify Result: ${passed ? 'Warnings found' : 'Failed'}`);
    console.log(`Score: ${score}/100`);

    console.log('');
    for (const issue of issues) {
      let icon = 'ℹ';
      if (issue.severity === 'error') icon = '✗';
      else if (issue.severity === 'warning') icon = '⚠';
      console.log(`${icon} [${issue.type}] ${issue.message}`);
      console.log(`  Fix: ${issue.fix}`);
      console.log('');
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    if (hasErrors) {
      if (options.noExit) return;
      process.exit(2);
    }
    if (options.noExit) return;
    process.exit(0);
  }

  // v0.7.6 FIX-1 (issue #9): wrap the bulk of verify (manifest/schema/hash/
  // policy checks + auto-fix) in a try/finally so the lock acquired above
  // is always released — even on a thrown error or an auto-fix subprocess
  // exit. The early-return `active_lock` branch above already bails before
  // reaching this block, so it does not need its own release.
  try {

  // 2. Check SQLite DB exists (v0.7.6 FIX-1: moved here from before lock
  //    acquisition so the active_lock fast path never sees a transient
  //    missing_database warning when rebuild is busy creating the index).
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
    try {
      db = openDatabase(pmemPath);
      createSchema(db);
    } catch (err: any) {
      issues.push({
        severity: 'error',
        type: 'corrupt_database',
        message: err?.message || '.pmem/pmem.db is corrupted.',
        fix: 'Back up the file if needed, then run: pmem rebuild --full',
      });
      db = null;
    }
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
            fix: 'Run: pmem rebuild (incremental rebuild will clean up stale card references)',
            card_id: card.id,
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

        // 6a. ID naming pattern — v0.7.0: render {types} placeholder if present
        const config = resolveConfig(manifest);
        const renderedPattern = renderIdPattern(policy.id_pattern, config.card_types);
        const idRegex = new RegExp(renderedPattern);
        for (const card of cards) {
          if (!idRegex.test(card.id)) {
            issues.push({
              severity: 'warning',
              type: 'card_id_violation',
              message: `Card "${card.id}" does not match naming pattern.`,
              fix: `Rename card ID to match: ${renderedPattern}`,
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
              // Check if relaxed locally (frontmatter or manifest list)
              const isLocalRelaxed = (() => {
                const parsed = parseFrontmatter(content);
                if (parsed?.data) {
                  if (parsed.data.relaxed === true || parsed.data.token_policy === 'relaxed') {
                    return true;
                  }
                }
                const relaxedCards = (policy as any).relaxed_cards;
                if (Array.isArray(relaxedCards) && relaxedCards.includes(card.id)) {
                  return true;
                }
                return false;
              })();

              const isRelaxed = !!(options.relaxed || isLocalRelaxed);

              if (isRelaxed) {
                issues.push({
                  severity: 'info',
                  type: 'card_too_large_relaxed',
                  message: `Card "${card.id}" (~${estimatedTokens} tokens) exceeds the normal limit of ${maxForType} tokens for type "${card.type}". (Relaxed/suppressed warning).`,
                  fix: `To restore normal limits, remove '--relaxed' option, delete 'relaxed: true'/'token_policy: relaxed' from card frontmatter, or remove the card ID from 'relaxed_cards' in .pmem/manifest.yml.`,
                  card_id: card.id,
                });
              } else {
                issues.push({
                  severity: 'warning',
                  type: 'card_too_large',
                  message: `Card "${card.id}" is ~${estimatedTokens} tokens, exceeding the max configured limit of ${maxForType} tokens for card type "${card.type}" by ${estimatedTokens - maxForType} tokens.`,
                  fix: `Consider splitting this card, or raise the limit in .pmem/manifest.yml (card_policy -> max_tokens -> ${card.type}).\n` +
                       `       To suppress this warning locally, add 'token_policy: relaxed' or 'relaxed: true' to the card's frontmatter, or add the card ID to 'relaxed_cards' in .pmem/manifest.yml.\n` +
                       `       To temporarily relax all limits, run: pmem verify --relaxed`,
                  card_id: card.id,
                });
              }
            }
          }
        }

        // 6c. Relation count threshold
        for (const card of cards) {
          const { count: relatedEdgeCount } = db.prepare(
            'SELECT COUNT(*) as count FROM edges WHERE from_id = ? OR to_id = ?'
          ).get(card.id, card.id) as { count: number };

          // Use per-card-type threshold if defined, otherwise fall back to global
          const threshold = policy.warn_when_related_count_gt_by_type?.[card.type]
            ?? policy.warn_when_related_count_gt;

          if (relatedEdgeCount > threshold) {
            // v0.7.6 (issue #10): fetch up to 10 lowest-confidence edges so the
            // agent can see which relations contribute to the count and which
            // are safe to prune. Sort ASC so lowest-confidence (best pruning
            // candidates) appear first.
            const topEdgesRaw = db.prepare(
              `SELECT from_id, to_id, type, source, confidence
               FROM edges
               WHERE from_id = ? OR to_id = ?
               ORDER BY confidence ASC
               LIMIT 10`
            ).all(card.id, card.id) as Array<{
              from_id: string;
              to_id: string;
              type: string;
              source: string;
              confidence: number;
            }>;

            const topEdges = topEdgesRaw.map(e => ({
              from_id: e.from_id,
              to_id: e.to_id,
              type: e.type,
              source: e.source,
              confidence: e.confidence,
            }));

            const pruningCandidates = topEdges.filter(
              e => e.source === 'inferred' || e.confidence < 0.5
            );

            issues.push({
              severity: 'warning',
              type: 'too_many_relations',
              message: `Card "${card.id}" has ${relatedEdgeCount} relations (threshold: ${threshold} for type "${card.type}").`,
              fix: `Run: pmem relations ${card.id} --format json to inspect.`,
              card_id: card.id,
              relation_count: relatedEdgeCount,
              threshold,
              top_edges: topEdges,
              pruning_candidates: pruningCandidates,
            });
          }
        }
      }

      // 9. Stale memory: source files newer than card update time
      // Uses shared consistency check to stay aligned with update --suggest
      const staleMemoryIssues = checkStaleMemory(pmemPath);
      for (const ci of staleMemoryIssues) {
        issues.push({
          severity: 'warning',
          type: ci.type,
          message: ci.message,
          fix: ci.card_id ? `Run: pmem update --confirm to update ${ci.card_id}.` : 'Run: pmem rebuild',
          card_id: ci.card_id,
        });
      }

      // 10. Agent-trust checks: confidence, classification, superseded references
      // These use info/warning severity as returned by the consistency functions.
      const trustIssues = verifyMemory(pmemPath)
        .filter(ci => ci.type !== 'stale_memory' && ci.type !== 'missing_contract_field');
      for (const ci of trustIssues) {
        // map 'blocking' → 'warning' for VerifyIssue compatibility
        const sev = ci.severity === 'blocking' ? 'warning' : ci.severity;
        issues.push({
          severity: sev as 'error' | 'warning' | 'info',
          type: ci.type,
          message: ci.message,
          fix: ci.card_id ? `Run: pmem update --confirm to update ${ci.card_id}.` : 'Run: pmem verify --fix',
          card_id: ci.card_id,
        });
      }

      // 11. Module boundary contract checks (v1.0.2)
      const contractIssues = checkModuleContracts(pmemPath);
      for (const ci of contractIssues) {
        issues.push({
          severity: 'info',
          type: ci.type,
          message: ci.message,
          fix: ci.card_id ? `Run: pmem update --confirm to update ${ci.card_id}.` : 'Run: pmem verify --fix',
          card_id: ci.card_id,
        });
      }

      // 12. Doc-pmem sync: detect drift (v1.0.2)
      const docSyncIssues = checkDocSync(pmemPath);
      for (const ci of docSyncIssues) {
        const sev = ci.severity === 'blocking' ? 'warning' : ci.severity;
        issues.push({
          severity: sev as 'error' | 'warning' | 'info',
          type: ci.type,
          message: ci.message,
          fix: ci.card_id ? `Run: pmem update --confirm to update ${ci.card_id}.` : 'Run: pmem verify --fix-stale',
          card_id: ci.card_id,
        });
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
  const infos = issues.filter(i => i.severity === 'info');
  const passed = errors.length === 0;
  const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 5);
  const missingSourceCount = issues.filter(i => i.type === 'missing_source_file').length;
  const untrackedCount = issues.filter(i => i.type === 'untracked_card').length;

  const result: VerifyResult = { passed, score, issues };

  // Output
  if (passed && warnings.length === 0) {
    console.log(`✓ Memory verification passed.`);
    console.log(`  Score: ${score}/100`);
    if (missingSourceCount > 0 || untrackedCount > 0) {
      console.log(`  Sync: ${missingSourceCount} cards reference missing files, ${untrackedCount} cards untracked`);
    }
    if (infos.length > 0) {
      console.log('');
      console.log('Informational Notes:');
      for (const issue of infos) {
        console.log(`ℹ [${issue.type}] ${issue.message}`);
      }
    }
    printDistillSuggestion(db, pmemPath);
    return;
  }

  console.log(`Memory Verify Result: ${passed ? 'Warnings found' : 'Failed'}`);
  console.log(`Score: ${score}/100`);
  if (missingSourceCount > 0 || untrackedCount > 0) {
    console.log(`Sync: ${missingSourceCount} cards reference missing files, ${untrackedCount} cards untracked`);
  }
  console.log('');

  for (const issue of issues) {
    let icon = 'ℹ';
    if (issue.severity === 'error') icon = '✗';
    else if (issue.severity === 'warning') icon = '⚠';
    console.log(`${icon} [${issue.type}] ${issue.message}`);
    console.log(`  Fix: ${issue.fix}`);
    console.log('');
  }

  printDistillSuggestion(db, pmemPath);
  // Helper to clean up stale DB card rows when source .md files are missing.
  // Called before rebuildCommand() so --fix / --fix-stale can immediately
  // remove stale card references without waiting for a full index rebuild.
  // Wrapped in a transaction for atomicity — a crash mid-cleanup rolls back.
  const cleanupMissingCards = (db: ReturnType<typeof openDatabase>, issues: VerifyIssue[]): void => {
    const missingCardIssues = issues.filter(i => i.type === 'missing_card_file' && i.card_id);
    if (missingCardIssues.length === 0) return;

    console.log(`Cleaning up ${missingCardIssues.length} stale card(s) from database...`);
    const cleanupTx = db.transaction(() => {
      for (const issue of missingCardIssues) {
        const cardId = issue.card_id!;
        db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?').run(cardId, cardId);
        db.prepare('DELETE FROM aliases WHERE card_id = ?').run(cardId);
        db.prepare('DELETE FROM tags WHERE card_id = ?').run(cardId);
        db.prepare('DELETE FROM paths WHERE card_id = ?').run(cardId);
        db.prepare('UPDATE cards SET is_deleted = 1 WHERE id = ?').run(cardId);
        console.log(`  Removed stale card: ${cardId}`);
      }
    });
    cleanupTx();
  };

  // --fix-stale: refresh stale_memory cards by bumping last_verified timestamps.
  // This is separate from --fix so agents can choose between "repair structural
  // index state" and "also acknowledge that source-file changes are reviewed."
  if (options.fixStale) {
    const staleIssues = issues.filter(i => i.type === 'stale_memory');

    if (staleIssues.length > 0 && db) {
      console.log(`Auto-fixing ${staleIssues.length} stale memory card(s)...`);
      for (const issue of staleIssues) {
        if (issue.card_id) {
          const card = db.prepare('SELECT file_path FROM cards WHERE id = ?').get(issue.card_id) as { file_path: string } | undefined;
          if (card) {
            const cardFilePath = path.join(cwd, card.file_path);
            if (fileExists(cardFilePath)) {
              updateFrontmatterTimestamp(cardFilePath, 'last_verified');
              console.log(`  Updated last_verified timestamp for card: ${issue.card_id}`);
            }
          }
        }
      }
      // Clean up stale DB rows for missing card files before rebuild
      cleanupMissingCards(db, issues);
      console.log('Rebuilding indexes for updated cards...');
      rebuildCommand();
    }

    // Also fix structural index issues (stale_index, etc.) when --fix-stale is used
    const fixableIssue = issues.find(i =>
      i.type === 'stale_index' ||
      i.type === 'missing_database' ||
      i.type === 'missing_card_file' ||
      i.type === 'orphan_edges'
    );
    if (fixableIssue && staleIssues.length === 0) {
      if (db) cleanupMissingCards(db, issues);
      console.log('Auto-fixing: rebuilding indexes...');
      rebuildCommand();
    }
  }

  // --fix: repair structural index state only (stale_index, missing db, etc.)
  // Does NOT touch stale_memory — use --fix-stale for that.
  if (options.fix && !options.fixStale) {
    const fixableIssue = issues.find(i =>
      i.type === 'stale_index' ||
      i.type === 'missing_database' ||
      i.type === 'missing_card_file' ||
      i.type === 'orphan_edges'
    );

    if (fixableIssue) {
      if (db) cleanupMissingCards(db, issues);
      console.log('Auto-fixing: rebuilding indexes...');
      rebuildCommand();
    }
  }

  // --fix-locks cleans stale locks during the check pass above,
  // but if a stale lock was found and not cleaned (e.g., --fix-locks not passed),
  // we provide guidance here.

  const hasErrors = issues.some(i => i.severity === 'error');
  if (hasErrors) {
    if (options.noExit) return;
    releaseLock(lockPath);
    process.exit(2);
  }
  if (options.noExit) return;
  releaseLock(lockPath);
  process.exit(0);

  } finally {
    // If we got here via an exception thrown during verify (e.g. a SQL
    // error from createSchema), still release the lock. The explicit
    // `releaseLock` calls above cover the normal exit paths since
    // `process.exit` does NOT run `finally` blocks.
    try { releaseLock(lockPath); } catch { /* ignore */ }
  }
}


function printDistillSuggestion(db: ReturnType<typeof openDatabase> | null, pmemPath: string): void {
  if (!db) return;
  try {
    const traceRow = db.prepare("SELECT COUNT(*) as count FROM cards WHERE type = 'trace' AND is_deleted = 0").get() as { count: number };
    const traceCount = traceRow?.count ?? 0;
    const urgency = getDistillUrgency(traceCount);
    if (urgency !== 'none') {
      console.log(`ℹ [auto_distill] ${traceCount} traces accumulated. Consider running: pmem distill --suggest`);
    }
  } catch {
    // Silently ignore DB errors — distill is a suggestion only
  }
}

function updateFrontmatterTimestamp(filePath: string, field: 'last_verified' | 'updated'): void {
  const content = readFile(filePath);
  if (!content) return;

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return;

  const frontmatterText = match[1];
  const nowStr = new Date().toISOString();

  let newFmText = frontmatterText;
  const regex = new RegExp(`^${field}:.*$`, 'm');
  if (regex.test(frontmatterText)) {
    newFmText = frontmatterText.replace(regex, `${field}: "${nowStr}"`);
  } else {
    // Trim end and add new field
    newFmText = frontmatterText.trimEnd() + `\n${field}: "${nowStr}"`;
  }

  const newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${newFmText}\n---`);
  const fs = require('fs');
  fs.writeFileSync(filePath, newContent, 'utf8');
}

