import * as path from 'path';
import { findProjectPaths } from '../core/projectRoot';
import { fileExists } from '../core/fs';
import { openCommandRuntime, type CommandRuntimeOptions } from './runtime';

export async function diffCommand(
  memoryId: string,
  format: 'compact' | 'json' = 'compact',
  options: { runtime?: CommandRuntimeOptions } = {},
): Promise<void> {
  const cwd = process.cwd();
  const project = findProjectPaths(cwd);
  const root = project?.projectRoot ?? cwd;
  if (!fileExists(path.join(root, '.pmem'))) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }
  let runtime;
  try {
    runtime = await openCommandRuntime(root, options.runtime);
    const result = await runtime.diff(memoryId);
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Memory diff (T-1 → T): ${result.memoryId}`);
    if (!result.current) {
      console.log('No durable state found.');
    } else if (result.diffStatus === 'unavailable') {
      console.log('Field-level diff unavailable: the latest event has no before/after snapshot.');
    } else {
      for (const change of result.changes ?? []) {
        console.log(`- ${change.path}: ${JSON.stringify(change.before)}\n+ ${JSON.stringify(change.after)}`);
      }
    }
    if (result.warnings?.length) for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  } catch (error: any) {
    if (format === 'json') {
      console.log(JSON.stringify({ memoryId, previous: null, current: null, diffStatus: 'unavailable', error: error?.message ?? String(error) }, null, 2));
      return;
    }
    console.log(`Memory diff failed: ${error?.message ?? String(error)}`);
  } finally {
    if (runtime) await runtime.close();
  }
}
