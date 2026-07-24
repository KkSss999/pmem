import * as path from 'path';
import { fileExists } from '../core/fs';
import { formatOutput } from '../core/format';
import { Pmem } from '../runtime';
import type { CliFormat } from '../types';

const PMEM_DIR = '.pmem';

export interface AskCommandOptions {
  explain?: boolean;
  limit?: number;
}

export async function askCommand(query: string, format: CliFormat = 'compact', options: AskCommandOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  if (!fileExists(dbPath)) {
    console.log('No SQLite database found. Run `pmem rebuild` first.');
    return;
  }

  let result;
  let pmem: Pmem | null = null;
  try {
    pmem = await Pmem.open({ root: cwd });
    result = await pmem.ask(query, {
      explain: options.explain,
      limit: options.limit,
    });
  } catch (err: any) {
    if (err?.message?.includes('not a valid SQLite database')) {
      console.log(err.message);
      return;
    }
    console.log(`Ask query failed: ${err?.message || err}`);
    console.log('Run `pmem rebuild --full` to rebuild the database.');
    return;
  } finally {
    if (pmem) await pmem.close();
  }

  const askMessage = result.matched.length > 0
    ? `Found ${result.matched.length} match(es).`
    : 'No matching memory cards found.';
  const askNextSteps = result.matched.length > 0 ? [] : [
    'Try a different query keyword',
    'Run `pmem recall` for full project context',
    'Check that cards have relevant aliases and tags',
  ];

  if (format === 'json') {
    console.log(JSON.stringify({
      ...result,
      message: askMessage,
      next_steps: askNextSteps,
    }, null, 2));
  } else if (format === 'paths' || format === 'pack') {
    console.log(formatOutput(result, format, 2000));
  } else {
    const lines: string[] = [`Query: ${result.query}`, ''];
    if (result.matched.length === 0) {
      lines.push('No matching memory cards found.');
      lines.push('');
      for (const step of askNextSteps) lines.push(`  - ${step}`);
    } else {
      lines.push('Matched:');
      for (const m of result.matched) {
        const score = m.score !== undefined ? ` (${m.score})` : '';
        const stale = m.stale ? ' ⚠stale' : '';
        let annotation = '';
        if (options.explain && m.reasons && m.reasons.length > 0) {
          const parts = m.reasons.map(r => `${r.channel}:${r.detail}`);
          annotation = ` [${parts.join('; ')}]`;
        } else {
          const via = m.match_type === 'graph_expansion' && m.from_card
            ? `via ${m.from_card}`
            : m.match_type;
          annotation = ` [${via}]`;
        }
        lines.push(`  - ${m.id}${score}${annotation}${stale}: "${m.title}"`);
      }
      lines.push('');
      lines.push('Recommended:');
      for (const f of result.recommended_files) lines.push(`  ${f}`);
      if (result.evidence_paths.length > 0) {
        lines.push('');
        lines.push('Evidence:');
        for (const f of result.evidence_paths.slice(0, 8)) lines.push(`  ${f}`);
      }
    }
    if (result.warnings && result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const warning of result.warnings) lines.push(`  - ${warning}`);
    }
    console.log(lines.join('\n'));
  }
}
