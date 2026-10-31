export const MEMORY_CHANGE_TYPES = [
  'replacement',
  'addition',
  'reinforcement',
  'conflict',
  'none',
] as const;

export type MemoryChangeType = (typeof MEMORY_CHANGE_TYPES)[number];

export interface MemoryChangeJudgment {
  changedL1Id: string;
  type: MemoryChangeType;
  probabilities?: Readonly<Record<string, number>>;
  confidence?: number;
}

export interface MemoryChangeJudgeInput {
  current: {
    title: string;
    summary: string;
    body: string;
    updatedAt: string;
  };
  changes: readonly {
    id: string;
    content: string;
    createdAt: string;
  }[];
}

/** A structured decision source used before rewriting a durable memory. */
export interface MemoryChangeJudge {
  readonly model: string;
  judge(input: MemoryChangeJudgeInput): Promise<readonly MemoryChangeJudgment[]>;
}

export class MemoryDecisionError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'failed' | 'unknown',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'MemoryDecisionError';
  }
}
