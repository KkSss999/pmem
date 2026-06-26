import * as path from 'path';
import { fileExists } from '../core/fs';
import { captureCore } from '../core/capture';

export function captureCommand(options: {
  auto?: boolean;
  summary?: string;
  next?: string;
  full?: boolean;
  force?: boolean;
}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  // Execute core capture
  const result = captureCore(pmemPath, {
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
  }
}
