import type { SemanticRebuildJob, SemanticRebuildOutcome } from '../core/semantic/rebuildRunner';
import { rebuildSemanticProject } from '../core/semantic/project';
import { createOfflineTransformersProvider } from '../core/semantic/transformers';

/** Send one IPC message and let the channel close so the process can exit. */
function report(message: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) return resolve();
    process.send(message, () => {
      process.disconnect?.();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const job = JSON.parse(process.argv[2] ?? '{}') as SemanticRebuildJob;
  if (!job.pmemPath || !job.spec?.cachePath)
    throw new Error('Semantic index worker received an invalid job.');
  const provider = await createOfflineTransformersProvider(job.spec);
  let result: SemanticRebuildOutcome;
  try {
    result = await rebuildSemanticProject(job.pmemPath, provider, { mode: job.mode });
  } finally {
    await provider.dispose();
  }
  await report({ ok: true, result });
}

main().catch(async (error: unknown) => {
  await report({ ok: false, error: (error as Error)?.message ?? String(error) });
  process.exitCode = 1;
});
