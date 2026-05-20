import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import { openDatabase, createSchema } from '../core/db';
import { formatOutput } from '../core/format';
import type { RecallResult, CliFormat, CardRow } from '../types';

const PMEM_DIR = '.pmem';

export function recallCommand(budget: number = 2000, format: CliFormat = 'compact'): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // Read hot memory files: index.md, state.md, next.md
  const indexContent = readFile(path.join(pmemPath, 'index.md'));
  const stateContent = readFile(path.join(pmemPath, 'state.md'));
  const nextContent = readFile(path.join(pmemPath, 'next.md'));

  if (!indexContent) {
    console.log('No .pmem/index.md found. Run `pmem init` first.');
    return;
  }

  // Parse project info from index
  const projectName = extractField(indexContent, 'Name:');
  const projectStage = extractField(indexContent, 'Stage:');
  const currentFocus = extractField(indexContent, 'Current Focus');

  // Parse state lines
  const stateLines: string[] = [];
  if (stateContent) {
    const lines = stateContent.split('\n');
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith('## ')) {
        inSection = !line.includes('Overall Status');
      } else if (inSection && line.trim().startsWith('-')) {
        stateLines.push(line.trim());
      }
    }
  }

  // Parse next step
  const nextStep = nextContent
    ? extractField(nextContent, '## Recommended Next Step')
    : 'No next step recorded.';

  // Build result
  const result: RecallResult & {
    dirty_flags_count: number;
    recent_updates: Array<{ action: string; summary: string | null; created_at: string }>;
    active_modules: string[];
  } = {
    project: projectName || 'Unknown',
    stage: projectStage || undefined,
    focus: currentFocus || 'No focus recorded.',
    state: stateLines,
    next: nextStep || 'No next step recorded.',
    mustRead: [],
    dirty_flags_count: 0,
    recent_updates: [],
    active_modules: [],
  };

  // Query SQLite for richer project info
  try {
    const db = openDatabase(pmemPath);
    createSchema(db);

    // Query active cards (non-deleted, non-candidate)
    const activeCards = db.prepare(
      "SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0"
    ).all() as CardRow[];

    // Modules for recommendations
    const modules = activeCards.filter(c => c.type === 'module');
    result.active_modules = modules.map(m => m.file_path);

    // Build mustRead list
    result.mustRead.push(path.join('.pmem', 'state.md'));
    result.mustRead.push(path.join('.pmem', 'next.md'));
    for (const mod of modules.slice(0, 5)) {
      result.mustRead.push(mod.file_path);
    }

    // Query unresolved dirty flags
    const dirtyFlagResult = db.prepare(
      "SELECT COUNT(*) as count FROM dirty_flags WHERE resolved_at IS NULL"
    ).get() as { count: number };
    result.dirty_flags_count = dirtyFlagResult.count;

    // Query recent updates
    const recentUpdates = db.prepare(
      "SELECT action, summary, created_at FROM update_log ORDER BY created_at DESC LIMIT 5"
    ).all() as Array<{ action: string; summary: string | null; created_at: string }>;
    result.recent_updates = recentUpdates;

  } catch {
    // DB may not exist yet or be uninitialized; file-based mustRead is sufficient
    if (result.mustRead.length === 0) {
      result.mustRead.push(path.join('.pmem', 'state.md'));
      result.mustRead.push(path.join('.pmem', 'next.md'));
    }
  }

  // Output
  const output = formatOutput(result, format, budget);
  console.log(output);
}

function extractField(content: string, fieldName: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(fieldName)) {
      const val = line.split(fieldName)[1]?.trim();
      if (val) return val;
      // Next line (for "## Current Focus" style)
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        return lines[i + 1].trim();
      }
    }
  }
  return null;
}
