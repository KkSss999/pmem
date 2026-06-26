import * as path from 'path';
import * as fs from 'fs';
import { readFile, fileExists } from '../fs';
import { openDatabase, createSchema } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import { parseTraceCard } from '../traceParse';
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

  // v0.7.5 trace integration fields
  recent_traces?: Array<{
    id: string;
    title: string;
    summary: string;
    file_path: string;
    created_at: string;
    changed_files: string[];
    what_changed: string[];
    decisions: string[];
    architecture_notes: string[];
    next: string[];
  }>;
  architecture?: Array<{
    id: string;
    title: string;
    summary: string | null;
    file_path: string;
    source_files: string[];
  }>;
  decisions?: Array<{
    id: string;
    title: string;
    summary: string | null;
    file_path: string;
  }>;
  context_summary?: string[];
}

export function recallQuery(pmemPath: string, options?: {
  budget?: number;
  since?: string;
  recent?: number;
  noTraces?: boolean;
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

  // Next steps parsing: first try standard managed block via helper
  let nextStep = '';
  if (nextContent) {
    nextStep = extractField(nextContent, '## Recommended Next Step') || '';
    if (!nextStep) {
      // Try parsing from managed block
      const managedStart = '<!-- pmem:next:start -->';
      const managedEnd = '<!-- pmem:next:end -->';
      const startIdx = nextContent.indexOf(managedStart);
      const endIdx = nextContent.indexOf(managedEnd);
      if (startIdx >= 0 && endIdx > startIdx) {
        const block = nextContent.substring(startIdx + managedStart.length, endIdx).trim();
        const blockLines = block.split('\n');
        for (const line of blockLines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('## Recommended Next Step')) {
            const nextIdx = blockLines.indexOf(line);
            if (nextIdx + 1 < blockLines.length) {
              nextStep = blockLines[nextIdx + 1].trim();
            }
          }
        }
        if (!nextStep && block) {
          nextStep = block;
        }
      }
    }
  }

  if (!nextStep) {
    nextStep = 'No next step recorded.';
  }

  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest) : { foundational_types: ['module'] };
  const foundationalTypes = config.foundational_types;

  const result: RecallQueryResult = {
    project: projectName || 'Unknown',
    stage: projectStage || undefined,
    focus: currentFocus || 'No focus recorded.',
    state: stateLines,
    next: nextStep,
    mustRead: [],
    dirty_flags_count: 0,
    recent_updates: [],
    active_modules: [],
    active_foundation: [],
    recent_traces: [],
    architecture: [],
    decisions: [],
    context_summary: []
  };

  // 1. Read traces from filesystem (independent of SQLite)
  const traceDir = path.join(pmemPath, 'traces');
  if (!options?.noTraces && fileExists(traceDir)) {
    try {
      const traceFiles = fs.readdirSync(traceDir)
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      const limit = options?.recent !== undefined ? options.recent : 5;
      for (const file of traceFiles.slice(0, limit)) {
        const filePath = path.join(traceDir, file);
        const content = readFile(filePath);
        if (content) {
          const parsed = parseTraceCard(content);
          if (parsed) {
            result.recent_traces?.push({
              id: parsed.id,
              title: parsed.title,
              summary: parsed.summary,
              file_path: path.relative(process.cwd(), filePath),
              created_at: parsed.createdAt,
              changed_files: parsed.changedFiles,
              what_changed: parsed.whatChanged,
              decisions: parsed.decisions,
              architecture_notes: parsed.architectureNotes,
              next: parsed.next
            });
          }
        }
      }
    } catch {}
  }

  // 2. Query SQLite for richer project info
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    result.mustRead.push('.pmem/state.md');
    result.mustRead.push('.pmem/next.md');
    // Synthesize context summary from traces
    if (result.recent_traces && result.recent_traces.length > 0) {
      result.context_summary = result.recent_traces.map(t => t.summary);
    } else {
      result.context_summary = [result.focus];
    }
    return result;
  }

  try {
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

    // Load active architecture modules
    const modules = db.prepare(
      "SELECT id, title, summary, file_path FROM cards WHERE type = 'module' AND is_deleted = 0 AND is_candidate = 0"
    ).all() as Array<{ id: string; title: string; summary: string | null; file_path: string }>;
    
    result.architecture = modules.map(m => {
      const paths = db.prepare("SELECT path FROM paths WHERE card_id = ? AND relation = 'source_file'").all(m.id) as Array<{ path: string }>;
      return {
        id: m.id,
        title: m.title,
        summary: m.summary,
        file_path: m.file_path,
        source_files: paths.map(p => p.path)
      };
    });

    // Load active decisions
    const decs = db.prepare(
      "SELECT id, title, summary, file_path FROM cards WHERE type = 'decision' AND is_deleted = 0 AND is_candidate = 0"
    ).all() as Array<{ id: string; title: string; summary: string | null; file_path: string }>;
    
    result.decisions = decs.map(d => ({
      id: d.id,
      title: d.title,
      summary: d.summary,
      file_path: d.file_path
    }));

  } catch (err: any) {
    // DB error fallback
  }

  // Synthesize context summary from traces
  if (result.recent_traces && result.recent_traces.length > 0) {
    result.context_summary = result.recent_traces.map(t => t.summary);
  } else {
    result.context_summary = [result.focus];
  }

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
