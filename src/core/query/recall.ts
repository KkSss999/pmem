import * as path from 'path';
import * as fs from 'fs';
import type Database from 'better-sqlite3';
import { readFile, fileExists, toPosixPath } from '../fs';
import { openDatabase, createSchema, getRecentRuntimeEvents } from '../db';
import { getCurrentBranch } from '../git';
import { loadManifest, resolveConfig } from '../manifest';
import { parseTraceCard } from '../traceParse';
import { isScopeVisible } from '../../runtime/scope';
import type { CardRow } from '../../types';
import { estimateTokens } from './engine/pack';

const PMEM_DIR = '.pmem';

/** Card row shape including v1.1 agent-trust columns used by recall. */
interface TrustCardRow {
  id: string;
  title: string;
  summary: string | null;
  file_path: string;
  confidence: number | null;
  superseded_by: string | null;
  classification: string | null;
  trust_label: string | null;
  sensitivity: string | null;
}

export interface RecallContentSummary {
  id: string;
  type: string;
  title: string;
  file_path: string;
  summary?: string;
  snippet?: string;
  updated_at?: string | null;
}

export interface RecallQueryResult {
  project: string;
  stage?: string;
  focus: string;
  state: string[];
  next: string;
  mustRead: string[];
  dirty_flags_count: number;
  recent_updates: Array<{ action: string; summary: string | null; created_at: string }>;
  recent_events?: Array<{ event_type: string; memory_id: string | null; branch: string | null; created_at: string; payload: string | null }>;
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
    confidence?: number | null;
    superseded_by?: string | null;
    classification?: string | null;
    trust_label?: string | null;
    sensitivity?: string | null;
  }>;
  decisions?: Array<{
    id: string;
    title: string;
    summary: string | null;
    file_path: string;
    confidence?: number | null;
    superseded_by?: string | null;
    classification?: string | null;
    trust_label?: string | null;
    sensitivity?: string | null;
  }>;
  context_summary?: string[];
  /** Budget-packed content for continuity; old path fields remain unchanged. */
  foundation_summaries?: RecallContentSummary[];
  recent_summaries?: RecallContentSummary[];
  content_budget?: {
    requested: number;
    used: number;
    dropped: number;
  };
}

export function recallQuery(pmemPath: string, options?: {
  budget?: number;
  since?: string;
  recent?: number;
  noTraces?: boolean;
  db?: Database.Database;
  cwd?: string;
  /** v1.1: when set, scoped events not visible to this principal are filtered out. */
  principal?: string;
}): RecallQueryResult {
  const cwd = options?.cwd ?? process.cwd();
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
    recent_events: [],
    active_modules: [],
    active_foundation: [],
    recent_traces: [],
    architecture: [],
    decisions: [],
    context_summary: [],
    foundation_summaries: [],
    recent_summaries: [],
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
              file_path: toPosixPath(path.relative(cwd, filePath)),
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
    const db = options?.db ?? openDatabase(pmemPath);
    if (!options?.db) createSchema(db);

    let sinceThreshold: string | null = null;
    if (options?.since) {
      sinceThreshold = parseSince(options.since);
      if (sinceThreshold === null) {
        throw new Error(`Invalid --since format: "${options.since}". Use <N>h, <N>d, or <N>w (e.g. 24h, 7d, 1w).`);
      }
    }

    const activeCardsRaw = sinceThreshold
      ? db.prepare(
          "SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0 AND updated_at >= ?"
        ).all(sinceThreshold) as CardRow[]
      : db.prepare(
          "SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0"
        ).all() as CardRow[];
    // v1.1: never surface secret-sensitivity cards (even their file paths) in recall.
    const activeCards = activeCardsRaw.filter(c => (c as any).sensitivity !== 'secret');

    const foundationalCards = activeCards.filter(c => foundationalTypes.includes(c.type));
    result.active_foundation = foundationalCards.map(c => c.file_path);
    result.active_modules = result.active_foundation;

    const foundationIds = new Set(foundationalCards.map(card => card.id));
    const recentCards = [...activeCards]
      .filter(card => !foundationIds.has(card.id))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.id.localeCompare(b.id))
      .slice(0, 10);
    const content = packContentSummaries(pmemPath, foundationalCards, recentCards, options?.budget ?? 2000);
    result.foundation_summaries = content.foundation;
    result.recent_summaries = content.recent;
    result.content_budget = content.budget;

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

    const currentBranch = getCurrentBranch(cwd);
    const principal = options?.principal;
    result.recent_events = getRecentRuntimeEvents(db, 20)
      .filter(e => !e.branch || !currentBranch || e.branch === currentBranch)
      // v1.1: enforce namespace isolation on scoped events when a principal is given.
      .filter(e => !principal || isScopeVisible(e.scope ?? (e.branch ? `branch:${e.branch}` : 'project'), principal))
      .slice(0, 5)
      .map(e => ({
        event_type: e.event_type,
        memory_id: e.memory_id,
        branch: e.branch,
        created_at: e.created_at,
        payload: e.payload,
      }));

    // Load active architecture modules
    const modules = db.prepare(
      "SELECT id, title, summary, file_path, confidence, superseded_by, classification, trust_label, sensitivity FROM cards WHERE type = 'module' AND is_deleted = 0 AND is_candidate = 0"
    ).all() as Array<TrustCardRow>;

    result.architecture = modules
      .filter(m => m.sensitivity !== 'secret')
      .map(m => {
        const paths = db.prepare("SELECT path FROM paths WHERE card_id = ? AND relation = 'source_file'").all(m.id) as Array<{ path: string }>;
        return {
          id: m.id,
          title: m.title,
          summary: m.summary,
          file_path: m.file_path,
          source_files: paths.map(p => p.path),
          confidence: m.confidence,
          superseded_by: m.superseded_by,
          classification: m.classification,
          trust_label: m.trust_label,
          sensitivity: m.sensitivity,
        };
      });

    // Load active decisions
    const decs = db.prepare(
      "SELECT id, title, summary, file_path, confidence, superseded_by, classification, trust_label, sensitivity FROM cards WHERE type = 'decision' AND is_deleted = 0 AND is_candidate = 0"
    ).all() as Array<TrustCardRow>;

    result.decisions = decs
      .filter(d => d.sensitivity !== 'secret')
      .map(d => ({
        id: d.id,
        title: d.title,
        summary: d.summary,
        file_path: d.file_path,
        confidence: d.confidence,
        superseded_by: d.superseded_by,
        classification: d.classification,
        trust_label: d.trust_label,
        sensitivity: d.sensitivity,
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

function packContentSummaries(
  pmemPath: string,
  foundationCards: CardRow[],
  recentCards: CardRow[],
  requestedBudget: number,
): {
  foundation: RecallContentSummary[];
  recent: RecallContentSummary[];
  budget: { requested: number; used: number; dropped: number };
} {
  const budget = Math.max(0, Number.isFinite(requestedBudget) ? Math.floor(requestedBudget) : 2000);
  const foundation: RecallContentSummary[] = [];
  const recent: RecallContentSummary[] = [];
  let used = 0;
  let dropped = 0;

  const add = (card: CardRow, target: RecallContentSummary[]): void => {
    const candidate = summarizeCard(pmemPath, card);
    const content = candidate.summary || candidate.snippet || '';
    if (!content) {
      dropped++;
      return;
    }
    const line = `${candidate.title} — ${content}`;
    const cost = estimateTokens(line);
    if (used + cost > budget) {
      dropped++;
      return;
    }
    target.push(candidate);
    used += cost;
  };

  for (const card of foundationCards) add(card, foundation);
  for (const card of recentCards) add(card, recent);
  return { foundation, recent, budget: { requested: budget, used, dropped } };
}

function summarizeCard(pmemPath: string, card: CardRow): RecallContentSummary {
  const result: RecallContentSummary = {
    id: card.id,
    type: card.type,
    title: card.title,
    file_path: card.file_path,
    updated_at: card.updated_at,
  };
  const summary = sanitizeContent(card.summary ?? '');
  if (summary) result.summary = summary;

  const projectRoot = path.resolve(pmemPath, '..');
  const filePath = path.resolve(projectRoot, card.file_path);
  const pmemRoot = path.resolve(pmemPath);
  if (filePath.startsWith(pmemRoot + path.sep)) {
    const source = readFile(filePath);
    if (source) {
      const body = source.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const paragraphs = body
        .split(/\n\s*\n/)
        .map(part => sanitizeContent(part.replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '')))
        .filter(Boolean);
      const paragraph = paragraphs.find(part => part !== card.title) ?? paragraphs[0];
      if (paragraph) result.snippet = paragraph.length > 420 ? `${paragraph.slice(0, 417).trimEnd()}...` : paragraph;
    }
  }
  return result;
}

const SENSITIVE_VALUE_RE = /(\b(?:api[-_ ]?key|secret(?:[-_ ]?key)?|password|passwd|token|authorization|bearer)\s*[:=]\s*["'`]?)([^\s,;"'`]+)/gi;
const KNOWN_TOKEN_RE = /\b(?:sk|rk)-[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b/g;

function sanitizeContent(value: string): string {
  return value
    .replace(SENSITIVE_VALUE_RE, '$1[REDACTED]')
    .replace(KNOWN_TOKEN_RE, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
