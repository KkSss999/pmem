import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TransformersModelSpec, TransformersRuntimeLoader } from './transformers';
import { createOfflineTransformersProvider } from './transformers';

export interface SemanticRebuildOutcome {
  cardsIndexed?: number;
  cardsSeen: number;
  cardsExcluded: number;
  chunksTotal: number;
  buildStatus?: 'complete' | 'partial';
  cardsFailed?: number;
  failedCardIds?: string[];
  failures?: Array<{ cardId: string; stage: string; error: string }>;
}

export interface SemanticRebuildJob {
  pmemPath: string;
  spec: TransformersModelSpec;
  mode: 'full' | 'incremental';
}

/** Compiled worker entry; absent when running from src (ts-node) without a build. */
function resolveWorkerEntry(): string | null {
  if (process.env.PMEM_SEMANTIC_INLINE === '1') return null;
  const entry = path.join(__dirname, '..', 'workers', 'semanticIndex.js');
  return fs.existsSync(entry) ? entry : null;
}

/**
 * Run the embedding pass in a throwaway child process. Disposing the pipeline
 * releases the tokenizer heap (~170MB) but glibc keeps the native arenas, so a
 * long-lived host process would stay ~440MB RSS. Process exit is the only way
 * to hand that memory back to the OS.
 */
export function rebuildInChildProcess(
  entry: string,
  job: SemanticRebuildJob,
): Promise<SemanticRebuildOutcome> {
  return new Promise((resolve, reject) => {
    const child = fork(entry, [JSON.stringify(job)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    child.on('message', (message: any) => {
      settled = true;
      if (message?.ok) resolve(message.result as SemanticRebuildOutcome);
      else reject(new Error(message?.error ?? 'Semantic index worker failed.'));
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (settled) return;
      reject(
        new Error(
          `Semantic index worker exited before reporting a result (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`,
        ),
      );
    });
  });
}

/** Rebuild in-process, or in a child process when the compiled worker is available. */
export async function runRebuild(
  core: {
    rebuildSemanticProject(
      pmemPath: string,
      provider: unknown,
      options: { mode: 'full' | 'incremental' },
    ): Promise<SemanticRebuildOutcome>;
  },
  pmemPath: string,
  spec: TransformersModelSpec,
  mode: 'full' | 'incremental',
  loadTransformers?: TransformersRuntimeLoader,
): Promise<SemanticRebuildOutcome> {
  const entry = resolveWorkerEntry();
  if (entry) return rebuildInChildProcess(entry, { pmemPath, spec, mode });
  const provider = await createOfflineTransformersProvider(spec, loadTransformers);
  try {
    return await core.rebuildSemanticProject(pmemPath, provider, { mode });
  } finally {
    await provider.dispose();
  }
}
