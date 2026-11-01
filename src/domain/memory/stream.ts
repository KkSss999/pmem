export const MEMORY_STREAM_KINDS = [
  'l1-extract',
  'l1-maintenance',
  'l2-synthesize',
  'l3-keywords',
] as const;

export type MemoryStreamKind = (typeof MEMORY_STREAM_KINDS)[number];
export type MemoryStreamState = 'pending' | 'running' | 'done' | 'failed' | 'unknown';

export interface MemoryStreamItem {
  id: string;
  workspaceId: string;
  scopeId: string;
  kind: MemoryStreamKind;
  subjectId: string;
  sourceHash: string;
  state: MemoryStreamState;
  attempt: number;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface EnqueueMemoryStreamItem {
  workspaceId: string;
  scopeId: string;
  kind: MemoryStreamKind;
  subjectId: string;
  sourceHash: string;
}
