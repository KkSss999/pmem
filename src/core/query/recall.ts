import * as path from 'path';
import { readFile, fileExists } from '../fs';
import { openDatabase, createSchema } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import type { CardRow } from '../../types';

const PMEM_DIR = '.pmem';

export interface RecallQueryResult {
  project: string;
  stage?: string;
  focus: string;
  state: string[];
  next: string;
  mustRead: string[];
  dirty_flags_count: number;
  recent_updates: Array<{ action: string; summary: string | null; created_at: string }>;
  active_modules: string[];
  active_foundation: string[];
}

export function recallQuery(pmemPath: string, options?: {
  budget?: number;
  since?: string;
}): RecallQueryResult {
  const indexContent = readFile(path.join(pmemPath, 'index.md'));
  const stateContent = readFile(path.join(pmemPath, 'state.md'));
  const nextContent = readFile(path.join(pmemPath, 'next.md'));

  if (!indexContent) {
    throw new Error('No .pmem/index.md found. Run `pmem init` first.');
  }

  const projectName = extractField(indexContent, 'Name:');
  const projectStage = extractField(indexContent, 'Stage:');
  const currentFocus = extractField(indexContent, 'Current Focus');

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

  const nextStep = nextContent
    ? extractField(nextContent, '## Recommended Next Step')
    : 'No next step recorded.';

  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest) : { foundational_types: ['module'] };
  const foundationalTypes = config.foundational_types;

  const result: RecallQueryResult = {
    project: projectName || 'Unknown',
    stage: projectStage || undefined,
    focus: currentFocus || 'No focus recorded.',
    state: stateLines,
    next: nextStep || 'No next step recorded.',
    mustRead: [],
    dirty_flags_count: 0,
    recent_updates: [],
    active_modules: [],
    active_foundation: [],
  };

  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    result.mustRead.push('.pmem/state.md');
    result.mustRead.push('.pmem/next.md');
    return result;
  }

  const db = openDatabase(pmemPath);
  createSchema(db);

  let sinceThreshold: string | null = null;
  if (options?.since) {
    sinceThreshold = parseSince(options.since);
    if (sinceThreshold === null) {
      throw new Error(`Invalid --since format: "${options.since}". Use <N>h, <N>d, or <N>w (e.g. 24h, 7d, 1w).`);
    }
  }

  const activeCards = sinceThreshold
    ? db.prepare(
        "SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0 AND updated_at >= ?"
      ).all(sinceThreshold) as CardRow[]
    : db.prepare(
        "SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0"
      ).all() as CardRow[];

  const foundationalCards = activeCards.filter(c => foundationalTypes.includes(c.type));
  result.active_foundation = foundationalCards.map(c => c.file_path);
  result.active_modules = result.active_foundation;

  result.mustRead.push('.pmem/state.md');
  result.mustRead.push('.pmem/next.md');
  for (const card of foundationalCards.slice(0, 5)) {
    result.mustRead.push(card.file_path);
  }

  const dirtyFlagResult = db.prepare(
    "SELECT COUNT(*) as count FROM dirty_flags WHERE resolved_at IS NULL"
  ).get() as { count: number };
  result.dirty_flags_count = dirtyFlagResult.count;

  const recentUpdates = db.prepare(
    "SELECT action, summary, created_at FROM update_log ORDER BY created_at DESC LIMIT 5"
  ).all() as Array<{ action: string; summary: string | null; created_at: string }>;
  result.recent_updates = recentUpdates;

  if (result.mustRead.length === 0) {
    result.mustRead.push('.pmem/state.md');
    result.mustRead.push('.pmem/next.md');
  }

  return result;
}

function extractField(content: string, fieldName: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(fieldName)) {
      const val = line.split(fieldName)[1]?.trim();
      if (val) return val;
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        return lines[i + 1].trim();
      }
    }
  }
  return null;
}

function parseSince(since: string): string | null {
  const match = since.match(/^(\d+)([hdw])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === 'h' ? value * 3600000
           : unit === 'd' ? value * 86400000
           : unit === 'w' ? value * 604800000
           : 0;
  if (ms === 0) return null;
  return new Date(Date.now() - ms).toISOString();
}
