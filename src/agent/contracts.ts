import type { L3ResolveOptions, L3ResolveResult } from '../domain/memory/l3';
import type { L1Memory } from '../domain/memory/l1';
import type { L2Memory } from '../domain/memory/l2';
import type { L0Message, MemoryAccess, MemorySpace } from '../domain/memory/types';

/** Stable identity supplied by the host for one Agent session. */
export interface PmemAgentBinding {
  workspaceId: string;
  agentId: string | null;
  sessionId: string;
}

/** The read-only Memory surface available to an Agent session. */
export interface PmemMemory {
  resolve(
    query: string,
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    options?: L3ResolveOptions
  ): L3ResolveResult;
  getL2(id: string, access: MemoryAccess): L2Memory | undefined;
  getL1(id: string, access: MemoryAccess): L1Memory | undefined;
  getL0(id: string, access: MemoryAccess): L0Message | undefined;
  listSpaces(access: MemoryAccess): MemorySpace[];
}

export interface PmemAgentScope {
  access: MemoryAccess;
  anchoredSpaceIds: readonly string[];
  /** L0 space used for this Agent session's transcript capture. */
  l0SpaceId: string;
}

/** Trusted host mapping from Agent identity to Memory access. Not model-controlled. */
export interface PmemAgentHost {
  scope(binding: PmemAgentBinding): PmemAgentScope;
}

export class PmemAgentError extends Error {
  constructor(
    readonly code: 'INVALID_OPTIONS' | 'WORKSPACE_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'PmemAgentError';
  }
}
