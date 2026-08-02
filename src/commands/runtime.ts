import { Pmem } from '../runtime';
import type { PmemOpenOptions } from '../runtime';

/** Optional injection surface for command/API callers; CLI keeps defaults. */
export type CommandRuntimeOptions = Pick<PmemOpenOptions, 'backend' | 'schema' | 'capabilities' | 'preset' | 'config'>;

export function openCommandRuntime(root: string, options?: CommandRuntimeOptions): Promise<Pmem> {
  return Pmem.open({ root, ...(options ?? {}) });
}
