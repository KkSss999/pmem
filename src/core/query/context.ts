import * as path from 'path';
import type Database from 'better-sqlite3';
import { fileExists } from '../fs';
import { openDatabase, createSchema, closeDatabase } from '../db';
import { recallQuery } from './recall';
import { askQuery } from './ask';
import { statusQuery } from './status';
import type { ContextQueryResult, ContextCardInfo } from '../../types';

export function contextQuery(pmemPath: string, task: string, budget = 4000, dbOverride?: Database.Database): ContextQueryResult {
  const dbPath = path.join(pmemPath, 'pmem.db');
  
  // Set up defaults
  const result: ContextQueryResult = {
    task,
    project_stage: undefined,
    current_focus: 'No focus recorded.',
    must_read: [
      { path: '.pmem/state.md', reason: 'Overall project stage and status' },
      { path: '.pmem/next.md', reason: 'Recommended next steps from last update' }
    ],
    relevant_memory: [],
    changed_files: [],
    dirty_memory: [],
    warnings: [],
    recommended_next_action: 'Read the suggested files to understand the context, then proceed with your task. Run pmem capture when done.'
  };

  if (!fileExists(pmemPath)) {
    result.warnings.push('No .pmem directory found. Run pmem init first.');
    return result;
  }

  // 1. Recall
  try {
    const recall = recallQuery(pmemPath, { budget, db: dbOverride });
    result.project_name = recall.project;
    result.project_stage = recall.stage;
    result.current_focus = recall.focus;

    if (recall.architecture) {
      result.current_architecture = recall.architecture.map(m => {
        const sum = m.summary ? ` — ${m.summary}` : '';
        return `${m.id}${sum}`;
      });
    }

    if (recall.recent_traces) {
      result.recent_session_memory = recall.recent_traces.map(t => t.summary);
    }
    if (recall.recent_events && recall.recent_events.length > 0) {
      const eventSummaries = recall.recent_events.map(e => {
        let payloadSummary = '';
        if (e.payload) {
          try {
            const parsed = JSON.parse(e.payload);
            payloadSummary = parsed.summary || parsed.reason || '';
          } catch {}
        }
        const branch = e.branch ? ` [${e.branch}]` : '';
        return `${e.event_type}${branch}${e.memory_id ? ` ${e.memory_id}` : ''}${payloadSummary ? ` — ${payloadSummary}` : ''}`;
      });
      result.recent_session_memory = [...(result.recent_session_memory ?? []), ...eventSummaries];
    }

    const decsSet = new Set<string>();
    const lowercaseDecs = new Set<string>();
    const addDecision = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!lowercaseDecs.has(lower)) {
        lowercaseDecs.add(lower);
        decsSet.add(trimmed);
      }
    };
    if (recall.decisions) {
      for (const d of recall.decisions) {
        addDecision(`${d.title}${d.summary ? ` — ${d.summary}` : ''}`);
      }
    }
    if (recall.recent_traces) {
      for (const t of recall.recent_traces) {
        for (const d of t.decisions) {
          addDecision(d);
        }
      }
    }
    result.relevant_decisions = Array.from(decsSet);
  } catch (err: any) {
    result.warnings.push(`Recall query failed: ${err.message}`);
  }

  // 2. Ask (Task-Aware)
  let askMatched: any[] = [];
  if (fileExists(dbPath)) {
    try {
      const ask = askQuery(pmemPath, task, { explain: true, limit: 12, db: dbOverride });
      askMatched = ask.matched || [];
    } catch (err: any) {
      result.warnings.push(`Ask query failed: ${err.message}`);
    }
  } else {
    result.warnings.push('No SQLite database found. Run pmem rebuild first.');
  }

  // 3. Status
  try {
    const status = statusQuery(pmemPath, { db: dbOverride });
    result.changed_files = (status.changes || []).map(c => ({
      path: c.path,
      status: c.status
    }));
  } catch (err: any) {
    result.warnings.push(`Status query failed: ${err.message}`);
  }

  // Database-dependent context enrichment
  if (fileExists(dbPath)) {
    try {
      const db = dbOverride ?? openDatabase(pmemPath);
      if (!dbOverride) createSchema(db);

      // Populate relevant_memory with titles and summaries
      for (const m of askMatched.slice(0, 10)) {
        const card = db.prepare(
          "SELECT type, title, summary, file_path FROM cards WHERE id = ? AND is_deleted = 0"
        ).get(m.id) as { type: string; title: string; summary: string | null; file_path: string } | undefined;
        
        if (card) {
          const reasons = Array.isArray(m.reasons)
            ? m.reasons.map((r: any) => r.channel).filter(Boolean).join(', ')
            : m.match_type;
          result.relevant_memory.push({
            id: m.id,
            title: card.title,
            file_path: card.file_path,
            summary: card.summary || undefined,
            type: card.type,
            score: m.score,
            reason: reasons || undefined,
            stale: m.stale === true
          });
        }
      }

      // Populate must_read with details of foundational cards
      const activeFoundationPaths = result.relevant_memory
        .slice(0, 3)
        .map(c => c.file_path);

      for (const fpath of activeFoundationPaths) {
        if (!result.must_read.some(r => r.path === fpath)) {
          const card = db.prepare(
            "SELECT type, id FROM cards WHERE file_path = ? AND is_deleted = 0"
          ).get(fpath) as { type: string; id: string } | undefined;
          
          if (card) {
            result.must_read.push({
              path: fpath,
              reason: `Task-relevant memory card: ${card.id} (${card.type})`
            });
          }
        }
      }

      // Populate dirty_memory
      const dirtyFlags = db.prepare(
        "SELECT target, reason FROM dirty_flags WHERE resolved_at IS NULL"
      ).all() as Array<{ target: string; reason: string }>;

      result.dirty_memory = dirtyFlags.map(df => df.target);

      if (dirtyFlags.length > 0) {
        result.warnings.push(`There are ${dirtyFlags.length} unresolved dirty flags. Remember to run pmem capture --auto when done.`);
      }

    } catch (err: any) {
      result.warnings.push(`Database context query enrichment failed: ${err.message}`);
    } finally {
      if (!dbOverride) closeDatabase();
    }
  }

  // Generate recommended next action
  if (result.changed_files.length > 0) {
    const filesToRead = result.relevant_memory.slice(0, 2).map(c => c.file_path);
    const filesStr = filesToRead.length > 0 ? `Read ${filesToRead.join(', ')} first. ` : '';
    result.recommended_next_action = `${filesStr}You have modified files. Review the suggested reads to see if their cards need updates, then run pmem capture when done.`;
  } else {
    const filesToRead = result.relevant_memory.slice(0, 2).map(c => c.file_path);
    const filesStr = filesToRead.length > 0 ? `Read ${filesToRead.join(', ')} first. ` : '';
    result.recommended_next_action = `${filesStr}Read the suggested files to understand the context, then proceed with your task. Run pmem capture when done.`;
  }

  return result;
}
