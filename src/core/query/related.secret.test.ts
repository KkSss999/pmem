import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createSchema, upsertCard, insertEdge } from '../db';
import { relatedQuery } from './related';
import { getDefaultManifest, saveManifest } from '../manifest';
import { ensureDir, writeFile } from '../fs';
import type { CardRow, EdgeRow } from '../../types';

function makeProject(): { root: string; pmemPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-related-secret-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('related-secret-test'));
  writeFile(path.join(pmemPath, 'index.md'), '# t\n');
  writeFile(path.join(pmemPath, 'state.md'), '# State\n');
  writeFile(path.join(pmemPath, 'next.md'), '# Next\n');
  return { root, pmemPath };
}

function card(id: string, sensitivity: string | null): CardRow {
  return {
    id, type: 'decision', title: `Title ${id}`, status: 'active', priority: null,
    file_path: `.pmem/decisions/${id}.md`, summary: `s ${id}`, schema_version: null, card_version: 1,
    created_at: null, updated_at: new Date().toISOString(), last_verified_at: null,
    file_hash: `h-${id}`, frontmatter_hash: `fm-${id}`, body_hash: `b-${id}`,
    token_count: 1, section_count: 1, is_deleted: 0, is_candidate: 0, sensitivity,
  } as CardRow;
}

function edge(from: string, to: string): EdgeRow {
  const now = new Date().toISOString();
  return { from_id: from, to_id: to, type: 'relates_to', source: 'explicit', confidence: 1.0, created_at: now, updated_at: now } as EdgeRow;
}

describe('related secret-sensitivity filtering', () => {
  it('treats a secret main card as not-found (no title/path leak)', () => {
    const { pmemPath } = makeProject();
    const db = new Database(path.join(pmemPath, 'pmem.db'));
    createSchema(db);
    upsertCard(db, card('decision.secret', 'secret'));
    assert.throws(() => relatedQuery(pmemPath, 'decision.secret', { db }), /not found/);
    db.close();
  });

  it('omits secret relation targets and counts only visible edges', () => {
    const { pmemPath } = makeProject();
    const db = new Database(path.join(pmemPath, 'pmem.db'));
    createSchema(db);
    upsertCard(db, card('decision.main', null));
    upsertCard(db, card('decision.public', null));
    upsertCard(db, card('decision.secret', 'secret'));
    insertEdge(db, edge('decision.main', 'decision.public'));
    insertEdge(db, edge('decision.main', 'decision.secret'));

    const result = relatedQuery(pmemPath, 'decision.main', { db });
    const allTargets = Object.values(result.edges_by_type).flat().map(e => e.target_id);
    assert.ok(allTargets.includes('decision.public'), 'public target present');
    assert.ok(!allTargets.includes('decision.secret'), 'secret target must be omitted');
    // secret title must not appear anywhere in the serialized result
    assert.ok(!JSON.stringify(result).includes('Title decision.secret'), 'secret title must not leak');
    assert.strictEqual(result.total_edges, 1, 'total_edges counts only visible edges');
    db.close();
  });
});
