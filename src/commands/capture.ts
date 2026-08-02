import * as path from 'path';
import { fileExists } from '../core/fs';
import { openDatabase } from '../core/db';
import { getDistillUrgency } from '../runtime/policy';
import { openCommandRuntime, type CommandRuntimeOptions } from './runtime';

export async function captureCommand(options: {
  auto?: boolean;
  summary?: string;
  next?: string;
  full?: boolean;
  force?: boolean;
  runtime?: CommandRuntimeOptions;
}): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const memory = await openCommandRuntime(cwd, options.runtime);
  try {
    const result = await memory.capture(options.summary ?? '', {
      auto: options.auto,
      summary: options.summary,
      next: options.next,
      full: options.full,
      force: options.force
    });

    if (!result.success) {
      console.error(`Error: ${result.message}`);
      process.exit(2);
    }

    if (result.skipped) {
      console.log(result.message);
    } else {
      console.log(result.message);
      if (result.tracePath) {
        console.log(`Trace card written: ${path.relative(cwd, result.tracePath)}`);
      }

      // Auto-distill suggestion
      const distillDb = openDatabase(pmemPath);
      try {
        const traceRow = distillDb.prepare("SELECT COUNT(*) as count FROM cards WHERE type = 'trace' AND is_deleted = 0").get() as { count: number };
        const traceCount = traceRow?.count ?? 0;
        const urgency = getDistillUrgency(traceCount);
        if (urgency !== 'none') {
          console.log(`ℹ [auto_distill] ${traceCount} traces accumulated. Consider running: pmem distill --suggest`);
        }
      } catch {
        // Silently ignore DB errors — distill is a suggestion only
      }
    }
  } finally {
    await memory.close();
  }
}
