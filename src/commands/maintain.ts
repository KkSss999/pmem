import * as path from 'node:path';
import { fileExists } from '../core/fs';
import { findProjectPaths } from '../core/projectRoot';
import { loadManifest } from '../core/manifest';
import {
  applyHealthMigration,
  parseClassificationByType,
  planHealthMigration,
  type HealthMigrationOptions,
  type HealthMigrationResult,
} from '../core/health/migration';
import { rebuildCommand } from './rebuild';
import { semanticCommand } from './semantic';
import { getSemanticProjectStatus } from '../core/semantic/project';
import type { ManifestV03 } from '../types';

export type MaintainFormat = 'compact' | 'json';

export interface MaintainCommandOptions {
  /** Preview unless explicitly requested with --repair. */
  repair?: boolean;
  /** Preview all stages and never write Markdown, manifest, or derived indexes. */
  dryRun?: boolean;
  /** Request a semantic rebuild when the manifest has semantic retrieval enabled. */
  semantic?: boolean;
  /** Required for a non-interactive repair; without it the command is cancelled. */
  yes?: boolean;
  format?: MaintainFormat;
  cwd?: string;
  trustLabel?: string;
  sensitivity?: string;
  classificationByType?: string | Record<string, string>;
}

export interface MaintainSemanticSnapshot {
  status: 'planned' | 'skipped' | 'completed' | 'failed';
  enabled: boolean;
  available: boolean | null;
  indexedCards: number | null;
  indexedChunks: number | null;
  cardsFailed: number;
  buildStatus: string | null;
  failedCardIds: string[];
  error?: string;
}

export interface MaintainResult {
  status: 'dry-run' | 'cancelled' | 'completed' | 'failed';
  phase: 'preflight' | 'migration' | 'rebuild' | 'semantic' | 'complete';
  dry_run: boolean;
  repair_requested: boolean;
  project: { root: string; pmem_path: string } | null;
  migration: HealthMigrationResult | null;
  rebuild: { status: 'planned' | 'skipped' | 'completed' | 'failed'; error?: string };
  semantic: MaintainSemanticSnapshot;
  errors: string[];
  recovery: string[];
}

export interface MaintainSemanticRunner {
  rebuild(pmemPath: string): Promise<unknown>;
  status(pmemPath: string): Promise<unknown>;
}

export interface MaintainCommandDependencies {
  planHealthMigration?: typeof planHealthMigration;
  applyHealthMigration?: typeof applyHealthMigration;
  rebuildCommand?: typeof rebuildCommand;
  semantic?: MaintainSemanticRunner;
  log?: (message: string) => void;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {};
}

function firstNumber(value: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key] as number;
  }
  return null;
}

function firstString(value: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key] as string;
  }
  return null;
}

function firstStringArray(value: UnknownRecord, keys: string[]): string[] {
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key].filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function semanticSnapshot(value: unknown, enabled: boolean): MaintainSemanticSnapshot {
  const record = asRecord(value);
  const failedCardIds = firstStringArray(record, ['failedCardIds', 'failed_card_ids']);
  const cardsFailed = firstNumber(record, ['cardsFailed', 'failedCardCount', 'failed_card_count']) ?? failedCardIds.length;
  return {
    status: 'completed',
    enabled,
    available: typeof record.available === 'boolean' ? record.available : null,
    indexedCards: firstNumber(record, ['indexedCards', 'indexed_cards', 'cardCount', 'cardsIndexed']),
    indexedChunks: firstNumber(record, ['indexedChunks', 'indexed_chunks', 'chunkCount', 'chunksTotal']),
    cardsFailed,
    buildStatus: firstString(record, ['buildStatus', 'build_status']),
    failedCardIds,
  };
}

function semanticFailure(snapshot: MaintainSemanticSnapshot): string | null {
  if (snapshot.available === false) return 'Semantic index is not available after rebuild.';
  if (snapshot.buildStatus === 'partial' || snapshot.cardsFailed > 0 || snapshot.failedCardIds.length > 0) {
    return `Semantic index is partial; failed card(s): ${snapshot.failedCardIds.join(', ') || snapshot.cardsFailed}.`;
  }
  if (snapshot.buildStatus === 'none') return 'Semantic index has no completed build.';
  if (snapshot.indexedCards === 0 || snapshot.indexedChunks === 0) return 'Semantic index contains 0 cards or chunks.';
  if (snapshot.indexedCards === null || snapshot.indexedChunks === null) return 'Semantic index readiness could not be verified.';
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function captureSemanticCommand(
  action: 'rebuild' | 'status',
  pmemPath: string,
): Promise<unknown> {
  let parsed: unknown;
  return semanticCommand(action, {
    cwd: path.dirname(pmemPath),
    format: 'json',
    full: action === 'rebuild',
  }, {
    log: (line) => {
      try { parsed = JSON.parse(line); } catch { /* compact diagnostics are not part of the API */ }
    },
  }).then(() => parsed ?? {});
}

function defaultSemanticRunner(): MaintainSemanticRunner {
  return {
    rebuild: (pmemPath) => captureSemanticCommand('rebuild', pmemPath),
    async status(pmemPath) {
      const commandStatus = await captureSemanticCommand('status', pmemPath);
      // The command boundary has historically exposed only readiness counters.
      // Read the richer lifecycle status when it is available, without making
      // the orchestrator depend on a particular version of the command output.
      try {
        return { ...asRecord(commandStatus), ...getSemanticProjectStatus(pmemPath) };
      } catch {
        return commandStatus;
      }
    },
  };
}

function migrationOptions(options: MaintainCommandOptions, cwd: string, apply: boolean): HealthMigrationOptions {
  const classificationByType = typeof options.classificationByType === 'string'
    ? parseClassificationByType(options.classificationByType)
    : options.classificationByType;
  return {
    apply,
    cwd,
    trustLabel: options.trustLabel,
    sensitivity: options.sensitivity,
    classificationByType,
  };
}

function emit(result: MaintainResult, format: MaintainFormat, log: (message: string) => void): void {
  if (format === 'json') {
    log(JSON.stringify(result, null, 2));
    return;
  }
  log(`Maintain ${result.status} (${result.phase}).`);
  if (result.migration) {
    log(`Migration: ${result.migration.scanned} scanned, ${result.migration.changed} change(s), ${result.migration.unresolved} unresolved.`);
    for (const card of result.migration.cards) {
      const fields = Object.entries(card.add).map(([key, value]) => `${key}=${value}`).join(', ') || 'none';
      const unresolved = card.unresolved.length ? `; unresolved: ${card.unresolved.join(', ')}` : '';
      log(`  ${card.id}: ${fields}${unresolved}`);
    }
  }
  log(`Rebuild: ${result.rebuild.status}.`);
  log(`Semantic: ${result.semantic.status}${result.semantic.enabled ? '' : ' (disabled)'}.`);
  for (const error of result.errors) log(`Error: ${error}`);
  for (const instruction of result.recovery) log(`Recovery: ${instruction}`);
}

function baseResult(options: MaintainCommandOptions, project: MaintainResult['project'], dryRun: boolean): MaintainResult {
  return {
    status: dryRun ? 'dry-run' : 'failed',
    phase: 'preflight',
    dry_run: dryRun,
    repair_requested: options.repair === true,
    project,
    migration: null,
    rebuild: { status: dryRun ? 'planned' : 'skipped' },
    semantic: {
      status: options.semantic ? 'planned' : 'skipped',
      enabled: false,
      available: null,
      indexedCards: null,
      indexedChunks: null,
      cardsFailed: 0,
      buildStatus: null,
      failedCardIds: [],
    },
    errors: [],
    recovery: [],
  };
}

/**
 * Orchestrate health metadata repair, the ordinary derived-index rebuild, and
 * an optional semantic rebuild. This is intentionally an API boundary: the
 * CLI can register it later without coupling this workflow to Commander.
 */
export async function maintainCommand(
  options: MaintainCommandOptions = {},
  dependencies: MaintainCommandDependencies = {},
): Promise<MaintainResult> {
  const start = options.cwd ?? process.cwd();
  const paths = findProjectPaths(start);
  const project = paths ? { root: paths.projectRoot, pmem_path: paths.pmemPath } : null;
  const dryRun = options.dryRun === true || options.repair !== true;
  const result = baseResult(options, project, dryRun);
  const log = dependencies.log ?? console.log;

  if (!paths || !fileExists(paths.pmemPath)) {
    result.status = 'failed';
    result.errors.push(`No .pmem directory found from ${path.resolve(start)}. Run \`pmem init\` first.`);
    result.phase = 'preflight';
    emit(result, options.format ?? 'compact', log);
    return result;
  }
  const manifest = loadManifest(paths.pmemPath);
  if (!manifest) {
    result.status = 'failed';
    result.errors.push('.pmem/manifest.yml is missing or invalid.');
    emit(result, options.format ?? 'compact', log);
    return result;
  }

  if (options.yes === true && options.repair !== true) {
    result.status = 'failed';
    result.phase = 'preflight';
    result.errors.push('--yes requires --repair; no changes were made.');
    emit(result, options.format ?? 'compact', log);
    return result;
  }
  if (!dryRun && options.yes !== true) {
    result.status = 'cancelled';
    result.phase = 'preflight';
    result.errors.push('Repair requires --yes in the callable non-interactive API; no changes were made.');
    emit(result, options.format ?? 'compact', log);
    return result;
  }

  const migration = dependencies.planHealthMigration ?? planHealthMigration;
  try {
    result.migration = migration(paths.pmemPath, migrationOptions(options, paths.projectRoot, false));
  } catch (error) {
    result.errors.push(errorMessage(error));
    emit(result, options.format ?? 'compact', log);
    return result;
  }
  const semanticEnabled = Boolean((manifest as ManifestV03).embedding?.enabled);
  result.semantic.enabled = semanticEnabled;
  if (!options.semantic) result.semantic.status = 'skipped';
  else if (!semanticEnabled) result.semantic.status = 'skipped';
  else result.semantic.status = dryRun ? 'planned' : 'planned';

  if (result.migration.unresolved > 0) {
    result.phase = 'migration';
    result.errors.push(`Migration has ${result.migration.unresolved} unresolved card(s); provide explicit trust, sensitivity, and classification choices.`);
    result.recovery.push('Re-run with --format json to review migration.cards, then provide the missing choices before --repair --yes.');
    emit(result, options.format ?? 'compact', log);
    return result;
  }

  if (dryRun) {
    result.status = 'dry-run';
    result.phase = 'complete';
    result.rebuild.status = 'planned';
    emit(result, options.format ?? 'compact', log);
    return result;
  }

  const rebuild = dependencies.rebuildCommand ?? rebuildCommand;
  const applyMigration = dependencies.applyHealthMigration ?? applyHealthMigration;
  let rebuildInvoked = false;
  try {
    result.migration = applyMigration(paths.pmemPath, {
      ...migrationOptions(options, paths.projectRoot, true),
      afterApply: () => {
        rebuildInvoked = true;
        rebuild({ cwd: paths.projectRoot, silent: true });
      },
      afterRollback: () => {
        rebuild({ cwd: paths.projectRoot, silent: true });
      },
    });
    if (!rebuildInvoked) {
      rebuildInvoked = true;
      rebuild({ cwd: paths.projectRoot, silent: true });
    }
    result.rebuild.status = 'completed';
  } catch (error) {
    result.phase = 'rebuild';
    result.rebuild.status = 'failed';
    result.rebuild.error = errorMessage(error);
    result.errors.push(errorMessage(error));
    result.recovery.push('Markdown rollback was delegated to the existing health migration backup/rollback path; inspect the backup and run `pmem rebuild` if needed.');
    emit(result, options.format ?? 'compact', log);
    return result;
  }

  if (options.semantic && semanticEnabled) {
    const semantic = dependencies.semantic ?? defaultSemanticRunner();
    try {
      const rebuildResult = await semantic.rebuild(paths.pmemPath);
      const statusResult = await semantic.status(paths.pmemPath);
      const snapshot = semanticSnapshot({ ...asRecord(rebuildResult), ...asRecord(statusResult) }, true);
      const failure = semanticFailure(snapshot);
      result.semantic = { ...snapshot, status: failure ? 'failed' : 'completed', error: failure ?? undefined };
      if (failure) {
        result.phase = 'semantic';
        result.errors.push(failure);
        result.recovery.push('Cross-stage rollback is not available after semantic index commit; restore the reported migration backup if Markdown rollback is required, then run `pmem rebuild` and `pmem semantic rebuild --full`.');
        emit(result, options.format ?? 'compact', log);
        return result;
      }
    } catch (error) {
      result.phase = 'semantic';
      result.semantic.status = 'failed';
      result.semantic.error = errorMessage(error);
      result.errors.push(errorMessage(error));
      result.recovery.push('Cross-stage rollback is not available after ordinary rebuild; inspect migration.backup_path, then run `pmem rebuild` and `pmem semantic rebuild --full` after recovery.');
      emit(result, options.format ?? 'compact', log);
      return result;
    }
  }

  result.status = 'completed';
  result.phase = 'complete';
  emit(result, options.format ?? 'compact', log);
  return result;
}
