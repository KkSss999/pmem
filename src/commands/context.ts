import * as path from 'path';
import { fileExists, readFile, writeFile } from '../core/fs';
import { parseStructuredNext } from '../core/next';
import { Pmem } from '../runtime';
import { openCommandRuntime, type CommandRuntimeOptions } from './runtime';
import type { PmemSessionData } from '../types';
import { findProjectPaths } from '../core/projectRoot';

export async function contextCommand(task: string, options: { budget?: number; format?: string; runtime?: CommandRuntimeOptions }): Promise<void> {
  const cwd = process.cwd();
  const project = findProjectPaths(cwd);
  const pmemPath = project?.pmemPath ?? path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const budget = options.budget ? Number(options.budget) : 4000;
  const format = options.format || 'compact';

  // 1. Run core context query through integrated runtime API
  let pmem: Pmem | null = null;
  let result;
  try {
    result = await (async () => {
      try {
        pmem = await openCommandRuntime(project?.projectRoot ?? cwd, options.runtime);
        return await pmem.context(task, budget);
      } finally {
        if (pmem) await pmem.close();
      }
    })();
  } catch (err: any) {
    if (err?.message?.includes('not a valid SQLite database')) {
      console.error(err.message);
    } else {
      console.error(`Context query failed: ${err?.message || err}`);
      console.error('Run `pmem rebuild --full` to rebuild the database.');
    }
    process.exit(2);
  }

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
    console.log('');

    // Display structured next steps from next.md
    const nextPath = path.join(pmemPath, 'next.md');
    if (fileExists(nextPath)) {
      const nextContent = readFile(nextPath) || '';
      const structuredItems = parseStructuredNext(nextContent);

      if (structuredItems.length > 0) {
        console.log('## Task Queue (from next.md)');
        const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
        const sorted = [...structuredItems].sort((a, b) => {
          const pa = a.priority ? (priorityOrder[a.priority] ?? 3) : 3;
          const pb = b.priority ? (priorityOrder[b.priority] ?? 3) : 3;
          return pa - pb;
        });
        for (const item of sorted) {
          const prefixParts: string[] = [];
          if (item.priority) prefixParts.push(`[${item.priority}]`);
          if (item.owner) prefixParts.push(`@${item.owner}`);
          const prefix = prefixParts.length > 0 ? `${prefixParts.join(' ')} ` : '';
          console.log(`- ${prefix}${item.step}`);
          for (const criterion of item.criteria) {
            console.log(`  - ${criterion}`);
          }
        }
        console.log('');
      }
    }
  }
}
