import * as path from 'path';
import { fileExists, writeFile } from '../core/fs';
import { contextQuery } from '../core/query/context';
import type { PmemSessionData } from '../types';

export function contextCommand(task: string, options: { budget?: number; format?: string }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const budget = options.budget ? Number(options.budget) : 4000;
  const format = options.format || 'compact';

  // 1. Run core context query
  const result = contextQuery(pmemPath, task, budget);

  // 2. Save task metadata to session.json
  const sessionPath = path.join(pmemPath, 'session.json');
  const sessionData: PmemSessionData = {
    latest_task: task,
    latest_context_query: task,
    latest_context_cards: result.relevant_memory.map(c => c.id),
    updated_at: new Date().toISOString()
  };
  try {
    writeFile(sessionPath, JSON.stringify(sessionData, null, 2));
  } catch (err: any) {
    console.error(`Warning: Failed to save session metadata: ${err.message}`);
  }

  // 3. Print output based on format
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Beautiful human/agent readable Markdown output
    console.log(`# PMEM_CONTEXT_READY: ${task}`);
    console.log('');
    console.log(`- **Project Stage**: ${result.project_stage || 'Not recorded'}`);
    console.log(`- **Current Focus**: ${result.current_focus}`);
    console.log('');

    console.log('## Suggested Reads');
    for (const item of result.must_read) {
      console.log(`- [${path.basename(item.path)}](file://${path.resolve(item.path)}) — ${item.reason}`);
    }
    console.log('');

    if (result.relevant_memory.length > 0) {
      console.log('## Relevant Memory Cards');
      for (const card of result.relevant_memory) {
        console.log(`- **${card.id}** (${card.type}): [${card.title}](file://${path.resolve(card.file_path)})`);
        if (card.summary) {
          console.log(`  > ${card.summary}`);
        }
      }
      console.log('');
    }

    if (result.changed_files.length > 0) {
      console.log('## Changed Files');
      for (const file of result.changed_files) {
        console.log(`- [${file.path}](file://${path.resolve(file.path)}) [${file.status}]`);
      }
      console.log('');
    }

    if (result.warnings.length > 0) {
      console.log('## Warnings / Status');
      for (const warning of result.warnings) {
        console.log(`- ${warning}`);
      }
      console.log('');
    }

    console.log('## Recommended Next Action');
    console.log(result.recommended_next_action);
  }
}
