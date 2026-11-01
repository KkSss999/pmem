import type {
  MaintenanceDecision,
  MaintenanceMemory,
  MaintenanceTask,
} from '../../domain/memory/l1-maintenance';

export interface MaintenanceSnapshot extends MaintenanceMemory {
  spaceId: string;
  scope: readonly string[];
  sourceIds: readonly string[];
  sequence: number;
  createdAt: string;
}
export interface PreparedMaintenance {
  memory: MaintenanceSnapshot;
  candidates: readonly MaintenanceSnapshot[];
}
export interface L1MaintenanceRepository {
  claimStream(id: string, allowed: readonly string[], token: string, now: string): boolean;
  prepare(ids: readonly string[], allowed: readonly string[], token: string): PreparedMaintenance[];
  apply(
    cases: readonly PreparedMaintenance[],
    decisions: readonly MaintenanceDecision[],
    allowed: readonly string[],
    token: string,
    now: string
  ): void;
  fail(
    ids: readonly string[],
    token: string,
    state: 'failed' | 'unknown',
    code: string,
    now: string
  ): void;
  release(ids: readonly string[], token: string, now: string): void;
  getTask(id: string, readable: readonly string[]): MaintenanceTask | undefined;
}
