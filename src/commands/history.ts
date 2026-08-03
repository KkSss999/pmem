import * as path from 'path';
import { findProjectPaths } from '../core/projectRoot';
import { fileExists } from '../core/fs';
import { openCommandRuntime, type CommandRuntimeOptions } from './runtime';
import type { MemoryHistoryOptions } from '../runtime';

export async function historyCommand(
  memoryId: string,
  format: 'compact' | 'json' = 'compact',
  options: MemoryHistoryOptions & { runtime?: CommandRuntimeOptions } = {},
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
    const result = await runtime.history(memoryId, options);
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Memory history: ${result.memoryId}`);
      if (result.entries.length === 0) {
        console.log('No durable history found.');
      } else {
        for (const entry of result.entries) {
          const detail = [entry.reason, entry.source, entry.diffStatus === 'available' ? `${entry.changes?.length ?? 0} field change(s)` : 'field diff unavailable']
            .filter(Boolean)
            .join(' · ');
          console.log(`${entry.recordedAt}  ${entry.type}  ${entry.eventId}${detail ? `  ${detail}` : ''}`);
        }
      }
      if (result.warnings?.length) for (const warning of result.warnings) console.log(`Warning: ${warning}`);
    }
  } catch (error: any) {
    if (format === 'json') {
      console.log(JSON.stringify({ memoryId, entries: [], error: error?.message ?? String(error) }, null, 2));
      return;
    }
    console.log(`Memory history failed: ${error?.message ?? String(error)}`);
  } finally {
    if (runtime) await runtime.close();
  }
}
