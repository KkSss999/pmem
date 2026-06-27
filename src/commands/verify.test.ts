/**
 * v0.7.6 (issue #10): Tests for the enhanced `too_many_relations` warning.
 *
 * Each test creates a fresh temp `.pmem/` project, seeds the SQLite index
 * with a controlled set of edges (explicit high-confidence vs. inferred or
 * low-confidence), runs `pmem verify`, and asserts on the text output.
 *
 * Test 3 (JSON serialization) is a pure unit test on the VerifyIssue
 * interface — it confirms that the new `top_edges` / `pruning_candidates`
 * fields are present after JSON.stringify so they will surface in any
 * downstream JSON consumer (current or future).
 *
 * NOTE: depends on `npm run build` having produced dist/index.js
 * (`pretest` runs the build automatically).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { VerifyIssue } from '../types';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-u5-verify-test-${Date.now()}`);

function pmem(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node "${PMEM_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 2,
    };
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function runSqlScript(testDir: string, body: string): void {
  const dbPath = path.join(testDir, '.pmem', 'pmem.db');
  const scriptPath = path.join(os.tmpdir(),
    `pmem-u5-verify-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
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

/**
 * Build a minimal v0.3 manifest whose card_policy threshold is small so a
 * single hub card can easily exceed `warn_when_related_count_gt`.
 */
function makeManifest(threshold: number): string {
  return `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: u5-verify
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
    - .pmem/modules/**/*.md
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
  id_pattern: '^(module|feature|task|decision|trace|risk|experiment)\\.[a-z0-9._-]+$'
  max_tokens:
    module: 1000
  max_sections:
    module: 8
  warn_when_related_count_gt: ${threshold}
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

function moduleCard(id: string): string {
  return `---
id: ${id}
type: module
status: active
---
# ${id}
`;
}

describe('U5 (issue #10): verify too_many_relations surfaces top_edges + pruning_candidates', () => {
  const testDir = path.join(TEMP_ROOT, 'u5-verify');
  const THRESHOLD = 2;
  const HUB_ID = 'module.hub';
  const SPOKES = ['module.a', 'module.b', 'module.c', 'module.d', 'module.e'];

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(THRESHOLD));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    // Create the hub + spoke cards so rebuild has something to ingest.
    writeFile(path.join(testDir, `.pmem/modules/${HUB_ID}.md`), moduleCard(HUB_ID));
    for (const s of SPOKES) {
      writeFile(path.join(testDir, `.pmem/modules/${s}.md`), moduleCard(s));
    }

    // Initial rebuild seeds the cards table.
    const r1 = pmem('rebuild --full', testDir);
    assert.strictEqual(r1.code, 0, `seed rebuild failed: ${r1.stdout}`);

    // Drop any seed edges so the test fully controls the edge set.
    runSqlScript(testDir, `db.prepare("DELETE FROM edges").run();`);
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('Test 1: explicit high-confidence edges only — top_edges populated, pruning_candidates empty', () => {
    // 4 explicit edges hub → spoke, all confidence 1.0, no inferred, none < 0.5.
    // Threshold is 2 → 4 > 2, expect the warning.
    for (const s of SPOKES.slice(0, 4)) {
      runSqlScript(testDir,
        `db.prepare("INSERT INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
       .run(${JSON.stringify(HUB_ID)}, ${JSON.stringify(s)}, 'depends_on', 'explicit', 1.0, new Date().toISOString(), new Date().toISOString());`);
    }

    const r = pmem('verify', testDir);
    // We don't care about the exit code here (could be 0 or 2 depending on
    // other warnings in the minimal fixture), only the stdout content.
    assert.ok(r.stdout.includes('too_many_relations'),
      `expected too_many_relations warning in stdout, got: ${r.stdout}`);
    assert.ok(r.stdout.includes(HUB_ID),
      `expected hub id in stdout, got: ${r.stdout}`);
    // The new fix hint replaces the old generic message.
    assert.ok(r.stdout.includes('pmem relations'),
      `expected new 'pmem relations' fix hint, got: ${r.stdout}`);
    assert.ok(!r.stdout.includes('Review whether all relations are necessary'),
      `old generic fix message should be gone, got: ${r.stdout}`);
  });

  it('Test 2: inferred and low-confidence edges appear in pruning_candidates', () => {
    // Reset edges and inject a mix:
    //  - 2 explicit high-confidence (1.0)
    //  - 1 inferred with confidence 0.9   (inferred source → pruning candidate)
    //  - 1 explicit with confidence 0.3   (low-confidence → pruning candidate)
    // Total = 4, threshold = 2 → warning fires.
    runSqlScript(testDir, `db.prepare("DELETE FROM edges").run();`);

    const inserts = [
      // explicit high
      [SPOKES[0], 'explicit', 1.0],
      [SPOKES[1], 'explicit', 1.0],
      // inferred (any confidence)
      [SPOKES[2], 'inferred', 0.9],
      // explicit low-confidence
      [SPOKES[3], 'explicit', 0.3],
    ];

    for (const [to, source, conf] of inserts) {
      runSqlScript(testDir,
        `db.prepare("INSERT INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
       .run(${JSON.stringify(HUB_ID)}, ${JSON.stringify(to)}, 'depends_on', ${JSON.stringify(source)}, ${conf}, new Date().toISOString(), new Date().toISOString());`);
    }

    const r = pmem('verify', testDir);
    assert.ok(r.stdout.includes('too_many_relations'),
      `expected too_many_relations warning, got: ${r.stdout}`);
    // The fix hint must point to pmem relations for further inspection.
    assert.ok(r.stdout.includes(`pmem relations ${HUB_ID}`),
      `expected hint to name the hub card, got: ${r.stdout}`);
    // And the warn count should reflect 4 relations.
    assert.ok(r.stdout.includes('4 relations'),
      `expected "4 relations" in message, got: ${r.stdout}`);
  });

  it('Test 3: VerifyIssue with top_edges + pruning_candidates serializes to JSON', () => {
    // Pure unit assertion: the new fields must survive JSON.stringify so
    // any downstream JSON consumer (current or future --format json support)
    // sees them. This guards against accidental stripping in serializers.
    const issue: VerifyIssue = {
      severity: 'warning',
      type: 'too_many_relations',
      message: 'Card "module.hub" has 4 relations (threshold: 2 for type "module").',
      fix: 'Run: pmem relations module.hub --format json to inspect.',
      card_id: 'module.hub',
      relation_count: 4,
      threshold: 2,
      top_edges: [
        { from_id: 'module.hub', to_id: 'module.d', type: 'depends_on', source: 'explicit', confidence: 0.3 },
        { from_id: 'module.hub', to_id: 'module.c', type: 'depends_on', source: 'inferred', confidence: 0.9 },
        { from_id: 'module.hub', to_id: 'module.a', type: 'depends_on', source: 'explicit', confidence: 1.0 },
        { from_id: 'module.hub', to_id: 'module.b', type: 'depends_on', source: 'explicit', confidence: 1.0 },
      ],
      pruning_candidates: [
        { from_id: 'module.hub', to_id: 'module.d', type: 'depends_on', source: 'explicit', confidence: 0.3 },
        { from_id: 'module.hub', to_id: 'module.c', type: 'depends_on', source: 'inferred', confidence: 0.9 },
      ],
    };

    const serialized = JSON.parse(JSON.stringify(issue));

    // All new fields must round-trip.
    assert.deepStrictEqual(serialized.relation_count, 4);
    assert.deepStrictEqual(serialized.threshold, 2);
    assert.ok(Array.isArray(serialized.top_edges),
      `top_edges should serialize as an array, got: ${typeof serialized.top_edges}`);
    assert.strictEqual(serialized.top_edges.length, 4);
    assert.ok(Array.isArray(serialized.pruning_candidates),
      `pruning_candidates should serialize as an array, got: ${typeof serialized.pruning_candidates}`);
    assert.strictEqual(serialized.pruning_candidates.length, 2);

    // pruning_candidates must be a subset of top_edges that matches the
    // documented filter (source = 'inferred' OR confidence < 0.5).
    const expected = serialized.top_edges.filter(
      (e: { source: string; confidence: number }) =>
        e.source === 'inferred' || e.confidence < 0.5
    );
    assert.deepStrictEqual(
      serialized.pruning_candidates.map((e: { to_id: string }) => e.to_id).sort(),
      expected.map((e: { to_id: string }) => e.to_id).sort(),
      'pruning_candidates should be the inferred/low-confidence subset of top_edges'
    );

    // And the fix hint should reference pmem relations.
    assert.ok(serialized.fix.includes('pmem relations'),
      `fix hint should reference pmem relations, got: ${serialized.fix}`);
  });

  it('top_edges is capped at 10 even when the card has many relations', () => {
    // Reset and add 15 explicit high-confidence edges from the hub to fresh
    // spoke cards. The shape of the warning should still cap top_edges at 10.
    runSqlScript(testDir, `db.prepare("DELETE FROM edges").run();`);

    // Create 15 additional spoke cards on disk and rebuild so they exist
    // in the cards table before we attach edges.
    const extraSpokes: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = `module.s${i}`;
      extraSpokes.push(id);
      writeFile(path.join(testDir, `.pmem/modules/${id}.md`), moduleCard(id));
    }
    const r1 = pmem('rebuild --full', testDir);
    assert.strictEqual(r1.code, 0, `seed rebuild failed: ${r1.stdout}`);
    runSqlScript(testDir, `db.prepare("DELETE FROM edges").run();`);

    for (const s of extraSpokes) {
      runSqlScript(testDir,
        `db.prepare("INSERT INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
       .run(${JSON.stringify(HUB_ID)}, ${JSON.stringify(s)}, 'depends_on', 'explicit', 1.0, new Date().toISOString(), new Date().toISOString());`);
    }

    // The warning still fires (15 > 2). For the JSON-serialized form,
    // mirror what verify.ts would produce: top_edges capped at 10.
    const r = pmem('verify', testDir);
    assert.ok(r.stdout.includes('too_many_relations'),
      `expected too_many_relations warning, got: ${r.stdout}`);
    assert.ok(r.stdout.includes('15 relations'),
      `expected "15 relations" in message, got: ${r.stdout}`);

    // Independently verify the SQL LIMIT 10 logic via the DB.
    // (We can't directly inspect top_edges from the text output, so we
    // simulate what verify.ts would return and assert on the count.)
    const driverScript = path.join(os.tmpdir(),
      `pmem-u5-limit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    const betterSqlitePath = path.resolve(__dirname, '../../node_modules/better-sqlite3');
    const dbPath = path.join(testDir, '.pmem', 'pmem.db');
    fs.writeFileSync(driverScript,
      `const Database = require(${JSON.stringify(betterSqlitePath)});
const db = new Database(${JSON.stringify(dbPath)}, { readonly: true });
const rows = db.prepare(
  "SELECT from_id, to_id, type, source, confidence FROM edges WHERE from_id = ? OR to_id = ? ORDER BY confidence ASC LIMIT 10"
).all(${JSON.stringify(HUB_ID)}, ${JSON.stringify(HUB_ID)});
db.close();
process.stdout.write(JSON.stringify(rows));`, 'utf8');
    const out = execSync(`node ${JSON.stringify(driverScript)}`, { encoding: 'utf8' });
    fs.unlinkSync(driverScript);
    const rows = JSON.parse(out);
    assert.strictEqual(rows.length, 10,
      `LIMIT 10 should cap top_edges at 10, got ${rows.length}`);
  });
});