import * as path from 'node:path';
import { fileExists, withLock } from '../core/fs';
import { writeHealthBaseline } from '../core/health';
import { applyHealthMigration, parseClassificationByType, type HealthMigrationOptions } from '../core/health/migration';
import { rebuildCommand } from './rebuild';
import { verifyCommand } from './verify';
import { findProjectPaths } from '../core/projectRoot';

export interface HealthBaselineCommandOptions { write?: boolean; format?: 'compact' | 'json'; cwd?: string }

export function healthBaselineCommand(options: HealthBaselineCommandOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const pmemPath = findProjectPaths(cwd)?.pmemPath ?? path.join(cwd, '.pmem');
  if (!fileExists(pmemPath)) throw new Error('No .pmem directory found. Run `pmem init` first.');
  if (!options.write) {
    const result = verifyCommand({ cwd, noExit: true, silent: true });
    if (!result) throw new Error('Unable to collect memory health.');
    const preview = { action: 'baseline-preview', issue_count: result.issues.length, baseline: result.baseline };
    console.log(options.format === 'json' ? JSON.stringify(preview, null, 2) : `Baseline preview: ${result.issues.length} current issue(s). Re-run with --write to accept them as historical debt.`);
    return;
  }
  const baseline = withLock(pmemPath, () => {
    const result = verifyCommand({ cwd, noExit: true, silent: true });
    if (!result) throw new Error('Unable to collect memory health.');
    return writeHealthBaseline(pmemPath, result.issues);
  }, { timeoutMs: 30000, onTimeout: 'error' });
  if (!baseline) throw new Error('Health baseline write was skipped because the pmem lock is active.');
  console.log(options.format === 'json'
    ? JSON.stringify({ action: 'baseline-write', path: path.relative(cwd, path.join(pmemPath, 'health-baseline.json')), entries: baseline.entries.length }, null, 2)
    : `Health baseline written: .pmem/health-baseline.json (${baseline.entries.length} accepted issue(s)).`);
}

export interface HealthMigrateCommandOptions extends Omit<HealthMigrationOptions, 'classificationByType'> {
  classificationByType?: string;
  format?: 'compact' | 'json';
}

export function healthMigrateCommand(options: HealthMigrateCommandOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const pmemPath = findProjectPaths(cwd)?.pmemPath ?? path.join(cwd, '.pmem');
  if (!fileExists(pmemPath)) throw new Error('No .pmem directory found. Run `pmem init` first.');
  const result = applyHealthMigration(pmemPath, {
    ...options,
    cwd,
    classificationByType: parseClassificationByType(options.classificationByType),
    afterApply: options.apply ? () => rebuildCommand({ cwd }) : undefined,
    afterRollback: options.apply ? () => rebuildCommand({ cwd }) : undefined,
  });
  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Health metadata migration (${result.mode}): ${result.scanned} scanned, ${result.changed} would change, ${result.unresolved} unresolved.`);
  for (const card of result.cards) {
    const additions = Object.entries(card.add).map(([key, value]) => `${key}=${value}`).join(', ') || 'none';
    const unresolved = card.unresolved.length ? `; unresolved: ${card.unresolved.join(', ')}` : '';
    console.log(`  ${card.id}: ${additions}${unresolved}`);
  }
  if (!options.apply) console.log('No files changed. Re-run with --apply and explicit trust/sensitivity choices.');
  else if (result.backup_path) console.log(`Backup: ${result.backup_path}`);
}
