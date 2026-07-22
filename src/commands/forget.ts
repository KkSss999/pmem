import * as path from 'path';
import { fileExists } from '../core/fs';
import { Pmem } from '../runtime';

export async function forgetCommand(memoryId: string, options: { reason?: string; confirm?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }
  if (!memoryId || !/^[a-z][a-z0-9._-]+$/.test(memoryId)) {
    console.error('Error: memoryId must be a valid pmem card id.');
    process.exit(2);
  }
  if (!options.confirm) {
    console.log(`Forget is a durable tombstone operation for ${memoryId}. Re-run with --confirm to apply.`);
    return;
  }

  const memory = await Pmem.open({ root: cwd });
  try {
    const result = await memory.forget({
      id: memoryId,
      reason: options.reason ?? 'CLI forget command',
      at: new Date().toISOString(),
    });
    console.log(`Memory forgotten: ${memoryId}`);
    console.log(`Tombstone event: ${result.id}`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  } finally {
    await memory.close();
  }
}
