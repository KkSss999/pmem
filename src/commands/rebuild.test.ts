/**
 * Integration tests for issue #6:
 *   `pmem rebuild --full` leaves orphan + stale depends_on + stale
 *   next_step_of edges in SQLite after card split/delete.
 *
 * These tests use the real CLI via child_process (matches the pattern
 * from new.test.ts and mcp/security.test.ts). Each test creates a fresh
 * temp project so they're CI-safe and don't touch the developer's .pmem/.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractWikilinks } from '../commands/rebuild';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-issue6-test-${Date.now()}`);

function pmem(args: string, cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node "${PMEM_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    return { stdout, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      code: err.status ?? 2,
    };
  }
}

function queryEdges(testDir: string, sql: string): Array<Record<string, string>> {
  // Write a small driver script to a temp .js file so we don't have to
  // wrestle with shell escaping when passing multi-line JS via -e.
  const dbPath = path.join(testDir, '.pmem', 'pmem.db');
  const scriptPath = path.join(os.tmpdir(), `pmem-issue6-query-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  const betterSqlitePath = path.resolve(__dirname, '../../node_modules/better-sqlite3');
  const script = `const Database = require(${JSON.stringify(betterSqlitePath)});
const db = new Database(${JSON.stringify(dbPath)}, { readonly: true });
const rows = db.prepare(${JSON.stringify(sql)}).all();
db.close();
process.stdout.write(JSON.stringify(rows));`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    const out = execSync(`node ${JSON.stringify(scriptPath)}`, { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

function runSqlScript(testDir: string, body: string): void {
  const dbPath = path.join(testDir, '.pmem', 'pmem.db');
  const scriptPath = path.join(os.tmpdir(), `pmem-issue6-inject-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  const betterSqlitePath = path.resolve(__dirname, '../../node_modules/better-sqlite3');
  const script = `const Database = require(${JSON.stringify(betterSqlitePath)});
const db = new Database(${JSON.stringify(dbPath)});
${body}
db.close();`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    execSync(`node ${JSON.stringify(scriptPath)}`, { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeManifest(cardGlobs: string): string {
  return `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: issue6-rebuild
  language: en
  status: active
memory_status:
  completeness: partial
  initialized_mode: minimal
  dirty: false
  dirty_since: null
  dirty_reason: null
source_of_truth:
  type: markdown_cards
  path: .pmem
  card_globs:
${cardGlobs.split('\n').map(g => `    - ${g}`).join('\n')}
runtime:
  mode: sqlite
  db_path: .pmem/pmem.db
  markdown_source: true
indexes:
  primary: sqlite
  legacy_json:
    enabled: false
    retained: true
    path: .pmem/indexes
rebuild:
  strategy: content_hash
  hash:
    file_hash: true
    frontmatter_hash: true
    body_hash: true
concurrency:
  mode: file-basic
  atomic_write: true
  lock:
    enabled: true
    path: .pmem/.lock
    timeout: 3s
    stale_after: 60s
    on_timeout: abort
  optimistic_lock:
    enabled: false
    note: ''
cli:
  default_format: compact
  supported_formats: [compact, json, paths, pack]
  default_budget: 1600
embedding:
  enabled: false
  provider: none
  model: null
  dimension: null
  store: sqlite
  index: none
serve:
  enabled: false
  mode: none
  experimental:
    mcp: false
    rest: false
auto_update:
  enabled: true
  on_code_change: mark_dirty
  on_doc_change: mark_dirty
  on_memory_change: rebuild_indexes
  on_session_end: prompt
  on_git_commit: suggest_trace
  min_trace_interval: 30m
  max_auto_traces_per_day: 5
  ignore_patterns: []
  trace_policy:
    require_meaningful_change: true
    require_summary: true
    require_related_node: true
card_policy:
  id_pattern: '^(module|task|feature|decision|trace|risk)\\.[a-z0-9._-]+$'
  max_tokens:
    module: 1000
    task: 800
  max_sections:
    module: 8
    task: 6
  warn_when_related_count_gt: 12
distill:
  enabled: true
  cadence: weekly
  max_undistilled_traces: 20
  require_confirmation: true
  suggest_card_splits: true
freshness:
  default_ttl: 14d
  stale_on_related_code_change: true
  require_last_verified: true
integrations:
  active: []
migrations:
  applied: []
`;
}

const CARD_GLOBS = `.pmem/modules/**/*.md
.pmem/tasks/**/*.md`;

function card(id: string, type: string, extraFm: string = ''): string {
  return `---
id: ${id}
type: ${type}
status: active
${extraFm}---
# ${id}
`;
}

describe('extractWikilinks', () => {
  it('extracts a single [[card-id]] from body text', () => {
    const body = 'The protagonist [[character.zero]] enters the room.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('extracts multiple distinct [[card-id]] references', () => {
    const body = `## Scene

[[character.zero]] meets [[character.lin-zhixu]] at [[world.shiyu]].

They discuss the events of [[chapter.vol1]].`;
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'chapter.vol1',
      'character.lin-zhixu',
      'character.zero',
      'world.shiyu',
    ].sort());
  });

  it('deduplicates repeated references', () => {
    const body = '[[character.zero]] appears. Then [[character.zero]] speaks. [[character.zero]] leaves.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('matches IDs with dots and hyphens', () => {
    const body = 'See [[module.auth_service]], [[decision.jwt_tokens]], and [[feature.user-login]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'decision.jwt_tokens',
      'feature.user-login',
      'module.auth_service',
    ].sort());
  });

  it('matches IDs with underscores', () => {
    const body = 'Reference: [[test.my_card_id_v2]]';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['test.my_card_id_v2']);
  });

  it('only matches lowercase IDs (pmem id_pattern is lowercase)', () => {
    const body = 'Valid: [[character.zero]] Invalid: [[Character.Zero]] Also invalid: [[CHARACTER.ZERO]].';
    const ids = extractWikilinks(body);
    // Only the lowercase version matches per pmem id_pattern rules
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('does not match invalid patterns', () => {
    const body = 'This is [not a wikilink] and (not one) and [[ also not one.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, []);
  });

  it('does not match IDs starting with a digit', () => {
    // pmem card IDs must start with a letter
    const body = 'Invalid: [[123.bad]] but valid: [[card.ok]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['card.ok']);
  });

  it('returns empty array for body with no wikilinks', () => {
    const body = '## Just a heading\n\nSome paragraph text with **bold** and *italic*.\n\n- list item';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, []);
  });

  it('returns empty array for empty body', () => {
    const ids = extractWikilinks('');
    assert.deepStrictEqual(ids, []);
  });

  it('extracts wikilinks embedded in markdown', () => {
    const body = `## Chapter 1

- **POV character**: [[character.lin-zhixu]]
- **Setting**: [[world.shiyu]]
- See also: [[arc.main_plot]]

> "Quote from [[character.zero]]" — referenced in [[decision.plot_twist]]`;
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'arc.main_plot',
      'character.lin-zhixu',
      'character.zero',
      'decision.plot_twist',
      'world.shiyu',
    ].sort());
  });

  it('handles wikilinks with numbers in the type part', () => {
    const body = 'Feature: [[v2.feature_name]] and [[module.v2_auth]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), ['module.v2_auth', 'v2.feature_name'].sort());
  });
});

// ── Issue #6: rebuild --full leaves orphan + stale edges ───────────────

describe('issue #6: pmem rebuild --full cleans stale/orphan edges after card split/delete', () => {
  const testDir = path.join(TEMP_ROOT, 'rebuild-stale-edges');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    fs.mkdirSync(path.join(pmemDir, 'tasks'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(CARD_GLOBS));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('Bug 1+2: deleting a target card and shrinking depends_on/related leaves only the current explicit edges', () => {
    // Setup: 4 cards. A is a hub referenced by B, C; X and Y are
    // siblings B depends on.  After the second rebuild, A's file is
    // gone, B depends only on X, C has no relations — so the only
    // edge that should survive is B→X.
    writeFile(path.join(testDir, '.pmem/modules/module.A.md'),
      card('module.A', 'module'));
    writeFile(path.join(testDir, '.pmem/modules/module.B.md'),
      card('module.B', 'module', 'depends_on:\n  - module.A\n  - module.X\n  - module.Y\n'));
    writeFile(path.join(testDir, '.pmem/modules/module.C.md'),
      card('module.C', 'module', 'related:\n  - module.A\n'));
    writeFile(path.join(testDir, '.pmem/modules/module.X.md'),
      card('module.X', 'module'));
    writeFile(path.join(testDir, '.pmem/modules/module.Y.md'),
      card('module.Y', 'module'));

    // First rebuild: seed the DB with the original edges.
    const r1 = pmem('rebuild --full', testDir);
    assert.strictEqual(r1.code, 0, `first rebuild failed: ${r1.stdout}`);

    const seeded = queryEdges(testDir,
      "SELECT from_id, to_id, type, source FROM edges ORDER BY from_id, to_id, type");
    const seededKeys = seeded.map(e => `${e.from_id}->${e.to_id}/${e.type}`);
    assert.ok(seededKeys.includes('module.B->module.A/depends_on'),
      `expected B->A in seeded edges, got: ${seededKeys.join(', ')}`);
    assert.ok(seededKeys.includes('module.B->module.X/depends_on'),
      `expected B->X in seeded edges, got: ${seededKeys.join(', ')}`);
    assert.ok(seededKeys.includes('module.C->module.A/related_to'),
      `expected C->A in seeded edges, got: ${seededKeys.join(', ')}`);

    // Now simulate a card split/delete: remove A's file, shrink
    // B's depends_on, clear C's related.
    fs.unlinkSync(path.join(testDir, '.pmem/modules/module.A.md'));
    fs.writeFileSync(path.join(testDir, '.pmem/modules/module.B.md'),
      card('module.B', 'module', 'depends_on:\n  - module.X\n'), 'utf8');
    fs.writeFileSync(path.join(testDir, '.pmem/modules/module.C.md'),
      card('module.C', 'module'), 'utf8');

    // Second rebuild --full: this is where the bug manifests.
    const r2 = pmem('rebuild --full', testDir);
    assert.strictEqual(r2.code, 0, `second rebuild failed: ${r2.stdout}`);

    const after = queryEdges(testDir,
      "SELECT from_id, to_id, type, source FROM edges ORDER BY from_id, to_id, type");
    const afterKeys = after.map(e => `${e.from_id}->${e.to_id}/${e.type}`);

    // B->X must survive (it's in current frontmatter).
    assert.ok(afterKeys.includes('module.B->module.X/depends_on'),
      `expected B->X to remain, got: ${afterKeys.join(', ')}`);

    // The three stale edges must be gone.
    assert.ok(!afterKeys.includes('module.B->module.A/depends_on'),
      `B->A should have been dropped (A deleted), got: ${afterKeys.join(', ')}`);
    assert.ok(!afterKeys.includes('module.B->module.Y/depends_on'),
      `B->Y should have been dropped (B's frontmatter shrunk to [X]), got: ${afterKeys.join(', ')}`);
    assert.ok(!afterKeys.includes('module.C->module.A/related_to'),
      `C->A should have been dropped (C's related cleared, A deleted), got: ${afterKeys.join(', ')}`);

    // No orphan edges — every from_id and to_id must be a real card row.
    const orphans = queryEdges(testDir, `
      SELECT e.from_id, e.to_id FROM edges e
      LEFT JOIN cards c1 ON e.from_id = c1.id
      LEFT JOIN cards c2 ON e.to_id   = c2.id
      WHERE c1.id IS NULL OR c2.id IS NULL
    `);
    assert.deepStrictEqual(orphans, [],
      `expected no orphan edges, got: ${JSON.stringify(orphans)}`);
  });

  it('Bug 3: inferred next_step_of edges from old completed tasks do not survive a frontmatter re-target', () => {
    // Setup: a task that points to module.M1.  Rebuild auto-derives
    // an inferred next_step_of T→M1.  Re-target the task to module.M2
    // and rebuild --full — the stale T→M1 inferred edge must be gone.
    writeFile(path.join(testDir, '.pmem/modules/module.M1.md'),
      card('module.M1', 'module'));
    writeFile(path.join(testDir, '.pmem/modules/module.M2.md'),
      card('module.M2', 'module'));
    writeFile(path.join(testDir, '.pmem/tasks/task.old.md'),
      card('task.old', 'task', 'status: completed\nrelated:\n  - module.M1\n'));

    const r1 = pmem('rebuild --full', testDir);
    assert.strictEqual(r1.code, 0, `first rebuild failed: ${r1.stdout}`);

    const seeded = queryEdges(testDir,
      "SELECT from_id, to_id, type, source FROM edges WHERE from_id='task.old' ORDER BY to_id, type");
    assert.ok(seeded.some(e => e.to_id === 'module.M1' && e.type === 'next_step_of' && e.source === 'inferred'),
      `expected inferred T->M1 next_step_of in seeded, got: ${JSON.stringify(seeded)}`);

    // Re-target: change related to module.M2, then rebuild --full.
    fs.writeFileSync(path.join(testDir, '.pmem/tasks/task.old.md'),
      card('task.old', 'task', 'status: completed\nrelated:\n  - module.M2\n'), 'utf8');

    const r2 = pmem('rebuild --full', testDir);
    assert.strictEqual(r2.code, 0, `second rebuild failed: ${r2.stdout}`);

    const after = queryEdges(testDir,
      "SELECT from_id, to_id, type, source FROM edges WHERE from_id='task.old' ORDER BY to_id, type");
    const toIds = after.map(e => e.to_id);
    assert.ok(!toIds.includes('module.M1'),
      `task.old should no longer point to module.M1, got: ${JSON.stringify(after)}`);
    assert.ok(toIds.includes('module.M2'),
      `task.old should now point to module.M2, got: ${JSON.stringify(after)}`);
  });

  it('preserves manual SQL edges that the rebuild loop never re-derives', () => {
    // The snapshot+restore mechanism exists so that edges inserted
    // outside the frontmatter flow (source != explicit/inferred/mention)
    // survive a --full rebuild.  Make sure the fix doesn't regress
    // that — a 'manual' edge with valid endpoints must round-trip.
    writeFile(path.join(testDir, '.pmem/modules/module.U.md'),
      card('module.U', 'module'));
    writeFile(path.join(testDir, '.pmem/modules/module.V.md'),
      card('module.V', 'module'));

    const r1 = pmem('rebuild --full', testDir);
    assert.strictEqual(r1.code, 0, `seed rebuild failed: ${r1.stdout}`);

    // Inject a manual edge by hand.
    runSqlScript(testDir,
      `db.prepare("INSERT INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, 1.0, ?, ?)")
    .run('module.U', 'module.V', 'custom_link', 'manual', new Date().toISOString(), new Date().toISOString());`);

    const r2 = pmem('rebuild --full', testDir);
    assert.strictEqual(r2.code, 0, `rebuild --full failed: ${r2.stdout}`);

    const after = queryEdges(testDir,
      "SELECT from_id, to_id, type, source FROM edges WHERE source='manual'");
    assert.deepStrictEqual(after, [{
      from_id: 'module.U', to_id: 'module.V',
      type: 'custom_link', source: 'manual',
    }], `manual edge should survive --full rebuild`);
  });
});
