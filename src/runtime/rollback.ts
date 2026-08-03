import { buildRepairPlan, type RepairChange, type RepairJsonValue } from './repair';

export interface RollbackCheckpoint {
  version: 1;
  id: string;
  planVersion: number;
  createdAt: string;
  changes: readonly RepairChange[];
  reversible: boolean;
  source: string;
}
export interface RollbackCheckpointInput {
  id: string;
  planVersion: number;
  createdAt: string;
  changes: readonly RepairChange[];
  reversible: boolean;
  source: string;
}

export interface RollbackRestoreFailure {
  id: string;
  message: string;
}

export type RollbackRestoreStatus = 'restored' | 'partial' | 'failed' | 'not-reversible';

export interface RollbackRestoreResult {
  status: RollbackRestoreStatus;
  restoredIds: readonly string[];
  skippedIds: readonly string[];
  failures: readonly RollbackRestoreFailure[];
}

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Rollback ${field} must be a non-empty string`);
}

function canonicalDate(value: string): string {
  nonEmpty(value, 'createdAt');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Rollback createdAt must be a valid ISO date');
  return date.toISOString();
}

function validatePlanVersion(value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`Rollback planVersion must be a positive integer, received ${String(value)}`);
}

/** Validate and defensively copy a checkpoint; no filesystem or database access occurs. */
export function validateRollbackCheckpoint(input: RollbackCheckpoint): RollbackCheckpoint {
  if (!input || typeof input !== 'object' || input.version !== 1) throw new TypeError('Unsupported rollback checkpoint version');
  nonEmpty(input.id, 'id');
  validatePlanVersion(input.planVersion);
  const createdAt = canonicalDate(input.createdAt);
  if (!Array.isArray(input.changes)) throw new TypeError('Rollback changes must be an array');
  if (typeof input.reversible !== 'boolean') throw new TypeError('Rollback reversible must be a boolean');
  nonEmpty(input.source, 'source');
  const plan = buildRepairPlan(input.changes, { apply: true });
  return {
    version: 1,
    id: input.id,
    planVersion: input.planVersion,
    createdAt,
    changes: plan.changes,
    reversible: input.reversible,
    source: input.source,
  };
}

/** Create a validated, serializable checkpoint from an immutable repair plan. */
export function createRollbackCheckpoint(input: RollbackCheckpointInput): RollbackCheckpoint {
  return validateRollbackCheckpoint({ version: 1, ...input });
}

function rollbackChange(checkpointId: string, change: RepairChange): RepairChange {
  return {
    id: change.id,
    action: `rollback:${change.action}`,
    reason: `Restore checkpoint ${checkpointId}: ${change.reason}`,
    before: change.after as RepairJsonValue,
    after: change.before as RepairJsonValue,
  };
}

/**
 * Restore through an injected writer. The checkpoint is validated completely
 * before the first write, and restoration stops after the first writer error.
 */
export function restoreRollbackCheckpoint(
  checkpointInput: RollbackCheckpoint,
  write: (change: RepairChange) => void,
): RollbackRestoreResult {
  const checkpoint = validateRollbackCheckpoint(checkpointInput);
  if (!checkpoint.reversible) {
    return {
      status: 'not-reversible',
      restoredIds: [],
      skippedIds: checkpoint.changes.map(change => change.id),
      failures: [],
    };
  }

  const restoredIds: string[] = [];
  const failures: RollbackRestoreFailure[] = [];
  let failed = false;
  for (const change of checkpoint.changes) {
    if (failed) continue;
    try {
      write(rollbackChange(checkpoint.id, change));
      restoredIds.push(change.id);
    } catch (error) {
      failed = true;
      failures.push({ id: change.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const restored = new Set(restoredIds);
  const failedIds = new Set(failures.map(failure => failure.id));
  return {
    status: failures.length === 0 ? 'restored' : restoredIds.length === 0 ? 'failed' : 'partial',
    restoredIds,
    skippedIds: checkpoint.changes.map(change => change.id).filter(id => !restored.has(id) && !failedIds.has(id)),
    failures,
  };
}
