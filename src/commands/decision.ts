import * as path from 'path';
import { fileExists } from '../core/fs';
import { inferDecisions, writeInferredDecisions, writeDecisionCandidates } from '../core/decisionInfer';

export function decisionInferCommand(options: { write?: boolean; fromTraces?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const inferred = inferDecisions(pmemPath);
  if (inferred.length === 0) {
    console.log('No decisions could be inferred from the current project traces.');
    return;
  }

  if (options.write) {
    const written = writeInferredDecisions(pmemPath, inferred);
    console.log(`Successfully wrote ${written.length} inferred decision card(s):`);
    for (const p of written) {
      console.log(`- ${path.relative(cwd, p)}`);
    }
    console.log('Next: run `pmem rebuild` to rebuild indexes.');
  } else {
    const candidatePath = writeDecisionCandidates(pmemPath, inferred);
    console.log(`Inferred ${inferred.length} decision candidate(s).`);
    console.log(`Candidate list written to: ${path.relative(cwd, candidatePath)}`);
    console.log('Run `pmem decision infer --write` to promote them to formal cards.');
  }
}
