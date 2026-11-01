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
  memoryId: string;
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
  if (!Array.isArray(rows) || rows.length !== cases.length)
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
      if (
        d.targetId !== null ||
        d.content !== null ||
        d.abstraction !== null ||
        !Array.isArray(d.cues) ||
        d.cues.length
      )
        throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid keep decision.');
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
    )
      throw new MemoryError('MODEL_OUTPUT_INVALID', 'Invalid merge decision.');
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

  prepareStream(memoryId: string, access: MemoryAccess): L1MaintenanceStreamPreparation {
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    identifier(memoryId, 'memory ID');
    const spaces = allowed(access);
    const token = randomUUID();
    const now = new Date().toISOString();
    if (!this.repository.claimStream(memoryId, spaces, token, now))
      throw new MemoryError('JOB_NOT_PENDING', 'Maintenance item is not pending.');
    const cases = this.repository.prepare([memoryId], spaces, token);
    const modelCases: MaintenanceCase[] = cases
      .filter((item) => item.candidates.length)
      .map((item) => ({
        memory: view(item.memory),
        candidates: item.candidates.map(view),
      }));
    return { memoryId, token, cases, modelCases, now };
  }

  applyStream(
    preparation: L1MaintenanceStreamPreparation,
    raw: unknown,
    access: MemoryAccess
  ): string | undefined {
    const spaces = allowed(access);
    try {
      const withCandidates = preparation.cases.filter((item) => item.candidates.length);
      const decisions = withCandidates.length ? validate(raw, withCandidates) : [];
      for (const item of preparation.cases)
        if (!item.candidates.length) decisions.push({ memoryId: item.memory.id, action: 'keep' });
      this.repository.apply(
        preparation.cases,
        decisions,
        spaces,
        preparation.token,
        new Date().toISOString()
      );
      return this.repository.getTask(preparation.memoryId, spaces)?.resultMemoryId;
    } catch (cause) {
      if (cause instanceof MemoryError && cause.code === 'SOURCE_CONFLICT') {
        this.repository.release(
          [preparation.memoryId],
          preparation.token,
          new Date().toISOString()
        );
        return undefined;
      }
      this.repository.fail(
        [preparation.memoryId],
        preparation.token,
        'failed',
        cause instanceof MemoryError ? cause.code : 'MAINTENANCE_UNKNOWN',
        new Date().toISOString()
      );
      throw cause;
    }
  }

  getTask(id: string, access: MemoryAccess): MaintenanceTask | undefined {
    identifier(id, 'memory ID');
    validateAccess(access);
    return this.repository.getTask(id, access.readableSpaceIds);
  }
}
