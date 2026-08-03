/** JSON-compatible values used in repair snapshots. */
export type RepairJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly RepairJsonValue[]
  | { readonly [key: string]: RepairJsonValue };

export interface RepairChange {
  /** Stable domain identifier used for ordering and idempotency. */
  id: string;
  /** Operation name interpreted by the caller (for example, update_frontmatter). */
  action: string;
  /** Human-readable, durable explanation for the change. */
  reason: string;
  /** Snapshot before the proposed repair. */
  before: RepairJsonValue;
  /** Snapshot after the proposed repair. */
  after: RepairJsonValue;
}

export type RepairPlanMode = 'dry-run' | 'apply';

export interface RepairPlan {
  version: 1;
  mode: RepairPlanMode;
  dryRun: boolean;
  apply: boolean;
  changes: readonly RepairChange[];
  checkpoint?: RepairCheckpointReceipt;
  apply_result?: RepairApplyResult;
}

export interface RepairCheckpointReceipt {
  id: string;
  path: string;
  reversible: boolean;
  state?: 'pending' | 'applied' | 'partial' | 'rolled_back' | 'rollback_failed';
  appliedIds?: readonly string[];
}

export type RepairApplyStatus = 'dry-run' | 'applied' | 'partial' | 'failed';

export interface RepairApplyFailure {
  id: string;
  message: string;
  compensation?: 'rolled_back' | 'rollback_failed';
}

export interface RepairApplyResult {
  status: RepairApplyStatus;
  appliedIds: readonly string[];
  skippedIds: readonly string[];
  failures: readonly RepairApplyFailure[];
  rollback?: RepairRollbackResult;
}

export interface RepairRollbackResult {
  status: 'not-requested' | 'restored' | 'partial' | 'failed' | 'not-reversible';
  restoredIds: readonly string[];
  failures: readonly RepairApplyFailure[];
}

export interface RepairPlanOptions {
  /** Preview by default; set apply to true to permit the executor callback. */
  dryRun?: boolean;
  apply?: boolean;
}

function isJsonValue(value: unknown): value is RepairJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}

function cloneJson(value: RepairJsonValue): RepairJsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, RepairJsonValue> = {};
    const objectValue = value as { readonly [key: string]: RepairJsonValue };
    for (const key of Object.keys(objectValue).sort()) output[key] = cloneJson(objectValue[key]!);
    return output;
  }
  return value;
}

function validateChange(change: RepairChange, index: number): RepairChange {
  if (!change || typeof change !== 'object') throw new TypeError(`Repair change at index ${index} must be an object`);
  if (typeof change.id !== 'string' || change.id.trim() === '') throw new TypeError(`Repair change at index ${index} has an invalid id`);
  if (typeof change.action !== 'string' || change.action.trim() === '') throw new TypeError(`Repair change ${change.id} has an invalid action`);
  if (typeof change.reason !== 'string' || change.reason.trim() === '') throw new TypeError(`Repair change ${change.id} has an invalid reason`);
  if (!isJsonValue(change.before) || !isJsonValue(change.after)) throw new TypeError(`Repair change ${change.id} snapshots must be JSON-compatible`);
  return {
    id: change.id,
    action: change.action,
    reason: change.reason,
    before: cloneJson(change.before),
    after: cloneJson(change.after),
  };
}

/** Build a stable plan without mutating candidates or touching project state. */
export function buildRepairPlan(
  candidates: readonly RepairChange[],
  options: RepairPlanOptions = {},
): RepairPlan {
  if (options.dryRun && options.apply) throw new Error('Repair plan cannot be both dry-run and apply.');
  const mode: RepairPlanMode = options.apply ? 'apply' : 'dry-run';
  const changes = candidates.map(validateChange);
  const ids = new Set<string>();
  for (const change of changes) {
    if (ids.has(change.id)) throw new Error(`Repair plan contains duplicate id ${change.id}`);
    ids.add(change.id);
  }
  changes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.action < b.action ? -1 : a.action > b.action ? 1 : 0);
  return {
    version: 1,
    mode,
    dryRun: mode === 'dry-run',
    apply: mode === 'apply',
    changes,
  };
}

/**
 * Execute a plan through an injected writer. The runner itself does not know
 * about Markdown, SQLite, or any domain semantics. It fails closed after the
 * first writer error and reports the remaining ids as skipped.
 */
export function applyRepairPlan(
  plan: RepairPlan,
  execute: (change: RepairChange) => void,
): RepairApplyResult {
  if (plan.version !== 1) throw new Error(`Unsupported repair plan version ${String(plan.version)}`);
  if (plan.dryRun || plan.mode === 'dry-run') {
    return { status: 'dry-run', appliedIds: [], skippedIds: plan.changes.map(change => change.id), failures: [] };
  }
  const appliedIds: string[] = [];
  const failures: RepairApplyFailure[] = [];
  let failed = false;
  for (const change of plan.changes) {
    if (failed) continue;
    try {
      execute(change);
      appliedIds.push(change.id);
    } catch (error) {
      failed = true;
      const detail = error as Error & { compensation?: RepairApplyFailure['compensation'] };
      failures.push({
        id: change.id,
        message: error instanceof Error ? error.message : String(error),
        ...(detail?.compensation ? { compensation: detail.compensation } : {}),
      });
    }
  }
  const applied = new Set(appliedIds);
  const failedIds = new Set(failures.map(failure => failure.id));
  const skippedIds = plan.changes.map(change => change.id).filter(id => !applied.has(id) && !failedIds.has(id));
  return {
    status: failures.length === 0 ? 'applied' : appliedIds.length === 0 ? 'failed' : 'partial',
    appliedIds,
    skippedIds,
    failures,
  };
}
