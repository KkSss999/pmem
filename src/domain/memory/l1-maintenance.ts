export interface MaintenanceMemory {
  id: string;
  content: string;
  abstraction: string;
  cues: readonly string[];
}

export interface MaintenanceCase {
  memory: MaintenanceMemory;
  candidates: readonly MaintenanceMemory[];
}

export interface L1MaintenanceModel {
  review(input: { cases: readonly MaintenanceCase[] }): Promise<unknown>;
}

export type MaintenanceDecision =
  | { memoryId: string; action: 'keep' | 'uncertain' }
  | {
      memoryId: string;
      action: 'merge';
      targetId: string;
      content: string;
      abstraction: string;
      cues: readonly string[];
    };

export interface MaintenanceTask {
  memoryId: string;
  spaceId: string;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  outcome?: string;
  resultMemoryId?: string;
  failureCode?: string;
}

export interface MaintenanceTaskPage {
  tasks: readonly MaintenanceTask[];
  nextId?: string;
}
