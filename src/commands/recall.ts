import * as path from 'path';
import { fileExists } from '../core/fs';
import { recallQuery } from '../core/query/recall';
import { formatOutput } from '../core/format';
import type { CliFormat } from '../types';

export function recallCommand(
  budget: number = 2000,
  format: CliFormat = 'compact',
  since?: string,
  options?: { recent?: number; noTraces?: boolean }
): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  try {
    const result = recallQuery(pmemPath, {
      budget,
      since,
      recent: options?.recent,
      noTraces: options?.noTraces
    });

    const output = formatOutput(result, format, budget);
    console.log(output);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }
}
