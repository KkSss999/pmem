import * as path from 'path';
import { fileExists, writeFile } from '../core/fs';
import { Pmem } from '../runtime';
import type { PmemSessionData } from '../types';

export async function contextCommand(task: string, options: { budget?: number; format?: string }): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const budget = options.budget ? Number(options.budget) : 4000;
  const format = options.format || 'compact';

  // 1. Run core context query through integrated runtime API
  let pmem: Pmem | null = null;
  const result = await (async () => {
    try {
      pmem = await Pmem.open({ root: cwd });
      return await pmem.context(task, budget);
    } finally {
      if (pmem) await pmem.close();
    }
  })();

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

    console.log('## Project Snapshot');
    console.log(`- **Project**: ${result.project_name || 'Unknown'}`);
    console.log(`- **Stage**: ${result.project_stage || 'Not recorded'}`);
    console.log(`- **Focus**: ${result.current_focus}`);
    console.log('');

    console.log('## Current Architecture');
    if (result.current_architecture && result.current_architecture.length > 0) {
      for (const arch of result.current_architecture) {
        console.log(`- ${arch}`);
      }
    } else {
      console.log('- (none)');
    }
    console.log('');

    console.log('## Recent Session Memory');
    if (result.recent_session_memory && result.recent_session_memory.length > 0) {
      for (const mem of result.recent_session_memory) {
        console.log(`- ${mem}`);
      }
    } else {
      console.log(`- ${result.current_focus}`);
    }
    console.log('');

    console.log('## Relevant Decisions');
    if (result.relevant_decisions && result.relevant_decisions.length > 0) {
      for (const dec of result.relevant_decisions) {
        console.log(`- ${dec}`);
      }
    } else {
      console.log('- (none)');
    }
    console.log('');

    if (result.changed_files.length > 0) {
      console.log('## Changed Files');
      for (const file of result.changed_files) {
        console.log(`- [${file.path}](file://${path.resolve(file.path)}) [${file.status}]`);
      }
      console.log('');
    }

    console.log('## Must Read');
    for (const item of result.must_read) {
      console.log(`- [${path.basename(item.path)}](file://${path.resolve(item.path)}) — ${item.reason}`);
    }
    console.log('');

    console.log('## Recommended Next Action');
    console.log(result.recommended_next_action);
  }
}
