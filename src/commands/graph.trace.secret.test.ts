import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createSchema, upsertCard, insertEdge, closeDatabase } from '../core/db';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { ensureDir, writeFile } from '../core/fs';
import { traceCommand } from './graph';
import type { CardRow, EdgeRow } from '../types';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-trace-secret-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('trace-secret-test'));
  writeFile(path.join(pmemPath, 'index.md'), '# t\n');
  writeFile(path.join(pmemPath, 'state.md'), '# State\n');
  writeFile(path.join(pmemPath, 'next.md'), '# Next\n');
  return root;
}

function card(id: string, sensitivity: string | null, type = 'decision'): CardRow {
  return {
    id, type, title: `Title ${id}`, status: 'active', priority: null,
    file_path: `.pmem/decisions/${id}.md`, summary: `s ${id}`, schema_version: null, card_version: 1,
    created_at: null, updated_at: new Date().toISOString(), last_verified_at: null,
    file_hash: `h-${id}`, frontmatter_hash: `fm-${id}`, body_hash: `b-${id}`,
    token_count: 1, section_count: 1, is_deleted: 0, is_candidate: 0, sensitivity,
  } as CardRow;
}

function edge(from: string, to: string, type = 'depends_on'): EdgeRow {
  const now = new Date().toISOString();
  return { from_id: from, to_id: to, type, source: 'explicit', confidence: 1.0, created_at: now, updated_at: now } as EdgeRow;
}

/** Run fn with cwd set to `dir`, capturing console.log output; always restores cwd. */
function captureInDir(dir: string, fn: () => void): string {
  const lines: string[] = [];
  const origLog = console.log;
  const origCwd = process.cwd();
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  // traceCommand uses the legacy openDatabase() singleton and never closes it;
  // reset it around each run so tests don't reuse a prior test's DB handle.
  closeDatabase();
  try {
    process.chdir(dir);
    fn();
  } finally {
    console.log = origLog;
    process.chdir(origCwd);
    closeDatabase();
  }
  return lines.join('\n');
}

describe('pmem trace (graph) secret-sensitivity filtering', () => {
  it('reports not-found for a secret main card (no title/file/body leak)', () => {
    const root = makeProject();
    const db = new Database(path.join(root, '.pmem', 'pmem.db'));
    createSchema(db);
    upsertCard(db, card('decision.secret', 'secret'));
    db.close();

    const out = captureInDir(root, () => traceCommand('decision.secret'));
    assert.match(out, /not found/);
    assert.ok(!out.includes('Title decision.secret'), 'secret title must not leak');
    assert.ok(!out.includes('.pmem/decisions/decision.secret.md'), 'secret file path must not leak');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('omits secret evidence and dependency targets from trace output', () => {
    const root = makeProject();
    const db = new Database(path.join(root, '.pmem', 'pmem.db'));
    createSchema(db);
    upsertCard(db, card('decision.main', null));
    upsertCard(db, card('decision.pubdep', null));
    upsertCard(db, card('decision.secretdep', 'secret'));
    insertEdge(db, edge('decision.main', 'decision.pubdep'));
    insertEdge(db, edge('decision.main', 'decision.secretdep'));
    db.close();

    const out = captureInDir(root, () => traceCommand('decision.main'));
    assert.ok(out.includes('decision.main'), 'main card shown');
    assert.ok(out.includes('decision.pubdep'), 'public dependency shown');
    assert.ok(!out.includes('decision.secretdep'), 'secret dependency id must not leak');
    assert.ok(!out.includes('Title decision.secretdep'), 'secret dependency title must not leak');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
