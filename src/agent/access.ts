import { PERSONAL_SPACE_ID, type MemoryAccess } from '../domain/memory/types';
import {
  PmemAgentError,
  type PmemAgentBinding,
  type PmemAgentHost,
  type PmemAgentScope,
} from './contracts';

export const PMEM_AGENT_WORKSPACE_ID = 'pmem';

export interface PmemAgentHostOptions {
  workspaceId?: string;
  spaceIds?: readonly string[];
  l0SpaceId?: string;
}

function scopeFor(workspaceId: string, options: PmemAgentHostOptions): PmemAgentScope {
  const spaceIds = [...new Set(options.spaceIds ?? [PERSONAL_SPACE_ID])];
  if (!spaceIds.length)
    throw new PmemAgentError('INVALID_OPTIONS', 'At least one Agent memory space is required.');
  const access: MemoryAccess = {
    readableSpaceIds: spaceIds,
    writableSpaceIds: spaceIds,
    canManageSpaces: false,
  };
  const l0SpaceId = options.l0SpaceId ?? spaceIds[0];
  if (!spaceIds.includes(l0SpaceId))
    throw new PmemAgentError('INVALID_OPTIONS', 'The L0 space must be readable and writable.');
  return { access, anchoredSpaceIds: spaceIds, l0SpaceId };
}

/**
 * Single-user host used until PMEM has a durable workspace-to-space mapping.
 * The model never supplies these IDs.
 */
export function createSingleUserAgentHost(options: PmemAgentHostOptions = {}): PmemAgentHost {
  const workspaceId = options.workspaceId ?? PMEM_AGENT_WORKSPACE_ID;
  const scope = scopeFor(workspaceId, options);
  return {
    scope(binding: PmemAgentBinding): PmemAgentScope {
      if (binding.workspaceId !== workspaceId)
        throw new PmemAgentError(
          'WORKSPACE_NOT_FOUND',
          `No PMEM memory scope is configured for workspace ${binding.workspaceId}.`
        );
      return scope;
    },
  };
}
