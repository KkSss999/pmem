import { randomUUID } from 'node:crypto';
import type {
  MaintenanceCase,
  MaintenanceDecision,
  MaintenanceMemory,
  MaintenanceTask,
} from '../../domain/memory/l1-maintenance';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { identifier, validateAccess } from './index';
import type { L1MaintenanceRepository, PreparedMaintenance } from './l1-maintenance-ports';

export interface L1MaintenanceStreamPreparation {
  memoryIds: string[];
  token: string;
  cases: readonly PreparedMaintenance[];
  modelCases: readonly MaintenanceCase[];
  now: string;
}

function allowed(access: MemoryAccess): string[] {
  validateAccess(access);
  return access.readableSpaceIds.filter((id) => access.writableSpaceIds.includes(id));
}

function view(memory: MaintenanceMemory): MaintenanceMemory {
  return {
    id: memory.id,
    content: memory.content,
    abstraction: memory.abstraction,
    cues: memory.cues,
  };
}

function validate(value: unknown, cases: readonly PreparedMaintenance[]): MaintenanceDecision[] {
  const rows =
    value && typeof value === 'object' ? (value as { decisions?: unknown }).decisions : undefined;
  // A model may skip a case; keeping it is the conservative outcome, so only an
  // unusable payload is rejected. Extra or duplicate IDs are still errors.
  if (!Array.isArray(rows) || rows.length > cases.length)
    throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid maintenance decisions.');
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row || typeof row !== 'object')
      throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid maintenance decision.');
    const d = row as Record<string, unknown>;
    const item = cases.find((entry) => entry.memory.id === d.memoryId);
    if (!item || typeof d.memoryId !== 'string' || seen.has(d.memoryId))
      throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid maintenance memory ID.');
    seen.add(d.memoryId);
    if (d.action === 'keep' || d.action === 'uncertain') {
      // Keeping a memory changes nothing, so any extra fields a model adds are
      // meaningless here. Rejecting them only produced retries and failures.
      return { memoryId: d.memoryId, action: d.action };
    }
    if (
      d.action !== 'merge' ||
      typeof d.targetId !== 'string' ||
      !item.candidates.some((candidate) => candidate.id === d.targetId) ||
      typeof d.content !== 'string' ||
      !d.content.trim() ||
      typeof d.abstraction !== 'string' ||
      !d.abstraction.trim() ||
      !Array.isArray(d.cues) ||
      d.cues.some((cue) => typeof cue !== 'string' || !cue.trim())
    ) {
      // An unusable merge is treated as "keep both": dropping the memory would be
      // worse than skipping one merge.
      return { memoryId: d.memoryId, action: 'uncertain' };
    }
    return {
      memoryId: d.memoryId,
      action: 'merge',
      targetId: d.targetId,
      content: d.content.trim(),
      abstraction: d.abstraction.trim(),
      cues: [...new Set((d.cues as string[]).map((cue) => cue.trim()))],
    };
  });
}

export class L1MaintenanceService {
  constructor(
    private readonly repository: L1MaintenanceRepository,
    private readonly readOnly: boolean
  ) {}

  prepareStream(
    memoryIds: string | readonly string[],
    access: MemoryAccess
  ): L1MaintenanceStreamPreparation {
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (typeof memoryIds === 'string') memoryIds = [memoryIds];
    if (!Array.isArray(memoryIds) || !memoryIds.length)
      throw new MemoryError('INVALID_INPUT', 'At least one memory ID is required.');
    const ids = [...new Set(memoryIds)];
    for (const id of ids) identifier(id, 'memory ID');
    const spaces = allowed(access);
    const token = randomUUID();
    const now = new Date().toISOString();
    const claimed: string[] = [];
    for (const id of ids) {
      if (!this.repository.claimStream(id, spaces, token, now)) continue;
      claimed.push(id);
    }
    if (!claimed.length)
      throw new MemoryError('JOB_NOT_PENDING', 'Maintenance item is not pending.');
    const cases = this.repository.prepare(claimed, spaces, token);
    const modelCases: MaintenanceCase[] = cases
      .filter((item) => item.candidates.length)
      .map((item) => ({
        memory: view(item.memory),
        candidates: item.candidates.map(view),
      }));
    return { memoryIds: claimed, token, cases, modelCases, now };
  }

  /** Apply the model decisions and return the memories whose maintenance committed. */
  applyStream(
    preparation: L1MaintenanceStreamPreparation,
    raw: unknown,
    access: MemoryAccess
  ): string[] {
    const spaces = allowed(access);
    try {
      const withCandidates = preparation.cases.filter((item) => item.candidates.length);
      const proposed = withCandidates.length ? validate(raw, withCandidates) : [];
      const decided = new Set(proposed.map((decision) => decision.memoryId));
      const decisions = [...proposed];
      for (const item of preparation.cases) {
        if (!item.candidates.length || !decided.has(item.memory.id))
          decisions.push({ memoryId: item.memory.id, action: 'keep' });
      }
      this.repository.apply(
        preparation.cases,
        decisions,
        spaces,
        preparation.token,
        new Date().toISOString()
      );
      // Return the memory each case ended up as: a merge points at its target, so
      // the follow-up L2 work names a memory that still exists.
      const results = preparation.memoryIds
        .map((id) => this.repository.getTask(id, spaces))
        .filter((task) => task?.state === 'succeeded')
        .map((task) => task!.resultMemoryId)
        .filter((id): id is string => typeof id === 'string');
      return [...new Set(results)];
    } catch (cause) {
      if (cause instanceof MemoryError && cause.code === 'SOURCE_CONFLICT') {
        this.repository.release(preparation.memoryIds, preparation.token, new Date().toISOString());
        return [];
      }
      this.repository.fail(
        preparation.memoryIds,
        preparation.token,
        'failed',
        cause instanceof MemoryError ? cause.code : 'MAINTENANCE_UNKNOWN',
        new Date().toISOString()
      );
      throw cause;
    }
  }

  /** Cases whose task is still pending after apply, e.g. a changed candidate. */
  pendingIds(memoryIds: readonly string[], access: MemoryAccess): string[] {
    const spaces = allowed(access);
    return memoryIds.filter((id) => this.repository.getTask(id, spaces)?.state === 'pending');
  }

  getTask(id: string, access: MemoryAccess): MaintenanceTask | undefined {
    identifier(id, 'memory ID');
    validateAccess(access);
    return this.repository.getTask(id, access.readableSpaceIds);
  }
}
