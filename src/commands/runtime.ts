import type { PmemOpenOptions } from '../runtime';
import { openV12Pmem } from '../compatibility/v1_2_runtime';
import type { Pmem } from '../runtime';

/** Optional injection surface for command/API callers; CLI keeps defaults. */
export type CommandRuntimeOptions = Pick<PmemOpenOptions, 'backend' | 'schema' | 'capabilities' | 'preset' | 'config'>;

export function openCommandRuntime(root: string, options?: CommandRuntimeOptions): Promise<Pmem> {
  return openV12Pmem({ root, ...(options ?? {}) });
}
