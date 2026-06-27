import * as path from 'path';
import { fileExists } from '../core/fs';
import { inferModules, writeInferredModules } from '../core/moduleInfer';

export interface ModuleInferOptions {
  write?: boolean;
  dryRun?: boolean;
  coarseAttribution?: boolean;
  format?: 'compact' | 'json';
}

export function moduleInferCommand(options: ModuleInferOptions): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const coarse = options.coarseAttribution === true;
  const inferred = inferModules(cwd, { coarseAttribution: coarse });
  const format = options.format || 'compact';

  if (inferred.length === 0) {
    if (format === 'json') {
      console.log(JSON.stringify({
        command: 'module.infer',
        state: 'empty',
        coarse_attribution: coarse,
        modules: []
      }, null, 2));
    } else {
      console.log('No modules could be inferred from the current project structure.');
    }
    return;
  }

  if (options.write && !options.dryRun) {
    const written = writeInferredModules(pmemPath, inferred);
    if (format === 'json') {
      console.log(JSON.stringify({
        command: 'module.infer',
        state: 'written',
        coarse_attribution: coarse,
        written: written.map(p => path.relative(cwd, p)),
        modules: inferred
      }, null, 2));
    } else {
      console.log(`Successfully wrote ${written.length} inferred module card(s):`);
      for (const p of written) {
        console.log(`- ${path.relative(cwd, p)}`);
      }
      console.log('Next: run `pmem rebuild` to rebuild indexes.');
    }
  } else {
    if (format === 'json') {
      console.log(JSON.stringify({
        command: 'module.infer',
        state: 'dry-run',
        coarse_attribution: coarse,
        modules: inferred
      }, null, 2));
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
}
