import * as path from 'path';
import { fileExists } from '../core/fs';
import { findProjectPaths } from '../core/projectRoot';
import { formatOutput } from '../core/format';
import { Pmem } from '../runtime';
import type { CliFormat } from '../types';

export async function recallCommand(
  budget: number = 2000,
  format: CliFormat = 'compact',
  since?: string,
  options?: { recent?: number; noTraces?: boolean; mode?: 'brief' | 'normal' | 'deep' }
): Promise<void> {
  const cwd = process.cwd();
  const project = findProjectPaths(cwd);
  const pmemPath = project?.pmemPath ?? path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  let pmem: Pmem | null = null;
  try {
    pmem = await Pmem.open({ root: project?.projectRoot ?? cwd });
    const result = await pmem.recall({
      budget,
      since,
      recent: options?.recent,
      noTraces: options?.noTraces
    });

    const output = formatOutput(
      options?.mode && format !== 'json' ? { ...result, recall_mode: options.mode } : result,
      format,
      budget
    );
    console.log(output);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  } finally {
    if (pmem) await pmem.close();
  }
}
