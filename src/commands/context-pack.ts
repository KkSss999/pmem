import * as path from 'node:path';
import { fileExists } from '../core/fs';
import { findProjectPaths } from '../core/projectRoot';
import { Pmem } from '../runtime';
import { openCommandRuntime, type CommandRuntimeOptions } from './runtime';
import type { ContextPack, PackContextOptions } from '../context-pack';

export type ContextPackCliFormat = 'compact' | 'text' | 'json';

export interface ContextPackCommandOptions extends PackContextOptions {
  format?: ContextPackCliFormat;
  runtime?: CommandRuntimeOptions;
}

/** Render the stable ContextPack wire shape for a human or machine caller. */
export function renderContextPack(pack: ContextPack, format: ContextPackCliFormat = 'compact'): string {
  return format === 'json' ? JSON.stringify(pack, null, 2) : pack.text;
}

/**
 * Retrieve a canonical ContextPack through the command Runtime bridge.
 * This command is read-only and never writes session or index state.
 */
export async function contextPackCommand(query: string, options: ContextPackCommandOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const project = findProjectPaths(cwd);
  const pmemPath = project?.pmemPath ?? path.join(cwd, '.pmem');
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    return;
  }
  if (!options.runtime?.backend && !fileExists(dbPath)) {
    console.error('Error: No SQLite database found. Run `pmem rebuild` first.');
    return;
  }

  let pmem: Pmem | null = null;
  try {
    pmem = await openCommandRuntime(project?.projectRoot ?? cwd, options.runtime);
    const pack = await pmem.packContext(query, {
      budget: options.budget ?? options.tokenBudget,
      maxRecords: options.maxRecords,
      maxEvidencePerRecord: options.maxEvidencePerRecord,
    });
    console.log(renderContextPack(pack, options.format));
  } catch (err: any) {
    if (err?.message?.includes('not a valid SQLite database')) {
      console.error(err.message);
      return;
    }
    console.error(`Context pack query failed: ${err?.message || err}`);
    console.error('Run `pmem rebuild --full` to rebuild the database.');
  } finally {
    if (pmem) await pmem.close();
  }
}
