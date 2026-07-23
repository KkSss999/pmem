import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createSchema, upsertCard } from '../db';
import { recallQuery } from './recall';
import { getDefaultManifest, saveManifest } from '../manifest';
import { ensureDir, writeFile } from '../fs';
import type { CardRow } from '../../types';

function makeProject(): { root: string; pmemPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-recall-secret-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('secret-test'));
  writeFile(path.join(pmemPath, 'index.md'), '# secret-test\n\nName: secret-test\n\n## Current Focus\nx\n');
  writeFile(path.join(pmemPath, 'state.md'), '# State\n\n## Overall Status\n- active\n');
  writeFile(path.join(pmemPath, 'next.md'), '# Next\n\n## Recommended Next Step\nx\n');
  return { root, pmemPath };
}

function decisionCard(id: string, sensitivity: string | null): CardRow {
  return {
    id, type: 'decision', title: `Title ${id}`, status: 'active', priority: null,
    file_path: `.pmem/decisions/${id}.md`, summary: `summary ${id}`, schema_version: null,
    card_version: 1, created_at: null, updated_at: new Date().toISOString(), last_verified_at: null,
    file_hash: `h-${id}`, frontmatter_hash: `fm-${id}`, body_hash: `b-${id}`,
    token_count: 1, section_count: 1, is_deleted: 0, is_candidate: 0,
    sensitivity,
  } as CardRow;
}

describe('recall secret-sensitivity filtering', () => {
  it('excludes secret-sensitivity decisions from recall output', () => {
    const { pmemPath } = makeProject();
    const dbPath = path.join(pmemPath, 'pmem.db');
    const db = new Database(dbPath);
    createSchema(db);
    upsertCard(db, decisionCard('decision.public', null));
    upsertCard(db, decisionCard('decision.secret', 'secret'));

    const result = recallQuery(pmemPath, { db, noTraces: true });
    const ids = (result.decisions ?? []).map(d => d.id);
    assert.ok(ids.includes('decision.public'), 'public decision should be present');
    assert.ok(!ids.includes('decision.secret'), 'secret decision must NOT be present');
    db.close();
  });
});
