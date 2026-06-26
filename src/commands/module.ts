import * as path from 'path';
import { fileExists } from '../core/fs';
import { inferModules, writeInferredModules } from '../core/moduleInfer';

export function moduleInferCommand(options: { write?: boolean; dryRun?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const inferred = inferModules(cwd);
  if (inferred.length === 0) {
    console.log('No modules could be inferred from the current project structure.');
    return;
  }

  if (options.write && !options.dryRun) {
    const written = writeInferredModules(pmemPath, inferred);
    console.log(`Successfully wrote ${written.length} inferred module card(s):`);
    for (const p of written) {
      console.log(`- ${path.relative(cwd, p)}`);
    }
    console.log('Next: run `pmem rebuild` to rebuild indexes.');
  } else {
    console.log(`Inferred ${inferred.length} module candidate(s) (dry-run):`);
    for (const m of inferred) {
      console.log(`\n- ID: ${m.id}`);
      console.log(`  Title: ${m.title}`);
      console.log(`  Purpose: ${m.purpose}`);
      console.log(`  Files: ${m.source_files.join(', ')}`);
      console.log(`  Knowledge:`);
      for (const k of m.current_knowledge) {
        console.log(`    - ${k}`);
      }
    }
    console.log('\nRun `pmem module infer --write` to save these cards to .pmem/modules/.');
  }
}
