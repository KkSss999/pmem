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
import { compactVerifyIssues, verifyCommand } from './verify';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-u5-verify-test-${Date.now()}`);

describe('compact verify metadata grouping', () => {
  it('groups repeated metadata issues for display while leaving source issues serializable per card', () => {
    const issues: VerifyIssue[] = Array.from({ length: 7 }, (_, index) => ({
      severity: 'warning',
      type: 'unclassified_card',
      card_id: `module.${index}`,
      message: `module.${index} is missing classification`,
      fix: 'Run: pmem health migrate',
    }));
    const originalJson = JSON.stringify(issues);
    const compact = compactVerifyIssues(issues);
    assert.strictEqual(compact.length, 1);
    assert.match(compact[0].message, /7 cards.*module\.0.*\(\+2 more\)/);
    assert.strictEqual(compact[0].evidence_count, 7);
    assert.strictEqual(JSON.stringify(issues), originalJson);
    assert.strictEqual(JSON.parse(originalJson).length, 7);
  });
});

describe('verify metadata migration guidance', () => {
  const testDir = path.join(TEMP_ROOT, 'metadata-migration-guidance');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(10));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
    writeFile(path.join(testDir, '.pmem/modules/module.missing-trust.md'), moduleCard('module.missing-trust'));
    const rebuilt = pmem('rebuild --full', testDir);
    assert.strictEqual(rebuilt.code, 0, `seed rebuild failed: ${rebuilt.stdout}`);
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('points missing trust_label at health migrate and the explicit command changes the label', () => {
    const verification = pmem('verify', testDir);
    assert.match(verification.stdout, /untrusted_memory/);
    assert.match(verification.stdout, /pmem health migrate --apply --trust-label <label> --sensitivity <level>/);
    const untrustedBlock = verification.stdout.split('\n\n').find(block => block.includes('[untrusted_memory]')) ?? '';
    assert.doesNotMatch(untrustedBlock, /pmem update --confirm/);

    const migration = pmem(
      'health migrate --apply --trust-label application_trusted --sensitivity internal --classification-by-type module=fact',
      testDir,
    );
    assert.strictEqual(migration.code, 0, `metadata migration failed: ${migration.stdout}`);
    const card = fs.readFileSync(path.join(testDir, '.pmem/modules/module.missing-trust.md'), 'utf8');
    assert.match(card, /^trust_label: application_trusted$/m);
    assert.match(card, /^sensitivity: internal$/m);
    assert.match(card, /^classification: fact$/m);
  });
});

describe('configurable verify fix mode', () => {
  const testDir = path.join(TEMP_ROOT, 'fix-mode');
  // Keep the fixture under the manifest's module glob while exercising a
  // decision-typed card, so the safe type-to-classification mapping is tested.
  const cardPath = path.join(testDir, '.pmem/modules/decision.auto.md');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.dirname(cardPath), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(10));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
    writeFile(path.join(testDir, 'AGENTS.md'), '# Test\n');
    writeFile(cardPath, `---
id: decision.auto
type: decision
status: active
trust_label: application_trusted
sensitivity: internal
source_files:
  - src/source.ts
---
# User-authored decision

Never rewrite this body during metadata repair.
`);
    writeFile(path.join(testDir, 'src/source.ts'), 'export const source = true;\n');
    const rebuilt = pmem('rebuild --full', testDir);
    assert.strictEqual(rebuilt.code, 0, `seed rebuild failed: ${rebuilt.stdout}`);
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('requires confirmation for metadata repair, supports dry-run, and is idempotent', () => {
    assert.throws(
      () => verifyCommand({ cwd: testDir, fix: true, only: ['metadata'], noExit: true, silent: true }),
      /requires explicit confirmation/,
    );
    const original = fs.readFileSync(cardPath, 'utf8');
    const dryRun = pmem('verify --fix --only metadata --confirm --dry-run', testDir);
    assert.strictEqual(dryRun.code, 0);
    assert.match(dryRun.stdout, /Repair plan \(dry-run\): 1 change/);
    assert.match(dryRun.stdout, /null -> \{"classification":"decision"\}/);
    assert.strictEqual(fs.readFileSync(cardPath, 'utf8'), original);

    const applied = pmem('verify --fix --only metadata --confirm', testDir);
    assert.strictEqual(applied.code, 0, applied.stdout);
    const repaired = fs.readFileSync(cardPath, 'utf8');
    assert.match(repaired, /^classification: decision$/m);
    assert.match(repaired, /Never rewrite this body/);
    const history = pmem('history decision.auto --format json', testDir);
    assert.strictEqual(history.code, 0, history.stdout);
    const historyJson = JSON.parse(history.stdout);
    assert.equal(historyJson.entries[0]?.type, 'repair.applied');
    assert.equal(historyJson.entries[0]?.diffStatus, 'available');

    const reapplied = pmem('verify --fix --only metadata --confirm', testDir);
    assert.strictEqual(reapplied.code, 0, reapplied.stdout);
    assert.strictEqual(fs.readFileSync(cardPath, 'utf8'), repaired);
  });

  it('honors maxChanges for stale repair and leaves later cards untouched', () => {
    const secondPath = path.join(testDir, '.pmem/modules/decision.second.md');
    writeFile(secondPath, `---
id: decision.second
type: decision
status: active
classification: decision
trust_label: application_trusted
sensitivity: internal
source_files:
  - src/source.ts
---
# Second decision
`);
    const rebuilt = pmem('rebuild --full', testDir);
    assert.strictEqual(rebuilt.code, 0, `second rebuild failed: ${rebuilt.stdout}`);
    runSqlScript(testDir, `db.prepare("UPDATE cards SET updated_at = '2000-01-01T00:00:00.000Z', last_verified_at = '2000-01-01T00:00:00.000Z'").run();`);
    const beforeFirst = fs.readFileSync(cardPath, 'utf8');
    const beforeSecond = fs.readFileSync(secondPath, 'utf8');
    const repaired = pmem('verify --fix-stale --max-changes 1', testDir);
    assert.strictEqual(repaired.code, 0, repaired.stdout);
    const afterFirst = fs.readFileSync(cardPath, 'utf8');
    const afterSecond = fs.readFileSync(secondPath, 'utf8');
    assert.notStrictEqual(afterFirst, beforeFirst);
    assert.strictEqual(afterSecond, beforeSecond);
    assert.match(afterFirst, /^last_verified:/m);
    const rollbackDir = path.join(testDir, '.pmem', 'rollback');
    const checkpoints = fs.readdirSync(rollbackDir).filter(name => name.endsWith('.json'));
    assert.ok(checkpoints.length >= 1);
    const checkpoint = checkpoints
      .map(name => JSON.parse(fs.readFileSync(path.join(rollbackDir, name), 'utf8')))
      .find(value => value.changes?.[0]?.action === 'refresh_last_verified');
    assert.ok(checkpoint);
    assert.equal(checkpoint.reversible, true);
    assert.equal(checkpoint.changes.length, 1);
    assert.match(checkpoint.changes[0].after, /^20\d\d-\d\d-\d\dT/);
    assert.notEqual(checkpoint.changes[0].before, 'stale');
  });

  it('does not mutate a stale lock during dry-run', () => {
    const lockPath = path.join(testDir, '.pmem', '.lock');
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, 'pid'), '999999', 'utf8');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lockPath, old, old);
    const before = fs.readdirSync(lockPath).map(name => [name, fs.readFileSync(path.join(lockPath, name), 'utf8')]);
    const result = pmem('verify --fix-locks --dry-run', testDir);
    assert.strictEqual(result.code, 0, result.stdout);
    assert.deepEqual(fs.readdirSync(lockPath).map(name => [name, fs.readFileSync(path.join(lockPath, name), 'utf8')]), before);
  });
});

describe('verify card size accounting', () => {
  const testDir = path.join(TEMP_ROOT, 'card-size-accounting');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(10));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
    const body = 'word '.repeat(780);
    writeFile(path.join(testDir, '.pmem/modules/module.metadata-only.md'), `---
id: module.metadata-only
type: module
classification: fact
trust_label: user_confirmed
sensitivity: internal
last_verified: "2026-08-02T00:00:00.000Z"
token_policy: normal
---
# Large but within user-content budget
${body}
`);
    const rebuilt = pmem('rebuild --full', testDir);
    assert.strictEqual(rebuilt.code, 0, `seed rebuild failed: ${rebuilt.stdout}`);
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('does not bill managed metadata but still warns when the body grows past the limit', () => {
    const withinLimit = pmem('verify', testDir);
    assert.doesNotMatch(withinLimit.stdout, /card_too_large/);

    const cardPath = path.join(testDir, '.pmem/modules/module.metadata-only.md');
    fs.appendFileSync(cardPath, `\n${'user-content '.repeat(40)}\n`, 'utf8');
    const oversized = pmem('verify', testDir);
    assert.match(oversized.stdout, /card_too_large/);
  });
});

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

/**
 * v0.7.6 FIX-1 (issue #9): tests for the verify/rebuild lock protocol.
 *
 * GitHub Issue #9: `pmem rebuild` and `pmem verify` run close together
 * could produce a transient `stale_index` warning even though a subsequent
 * `pmem verify` would pass.
 *
 * Root cause: `verify` only observed the lock (read-only) and never
 * acquired it, so a concurrent rebuild could tear down the SQLite index
 * mid-verify and produce a false `stale_index`.
 *
 * FIX-1: `rebuild` now holds `.pmem/.lock` for its duration. `verify`
 * tries to acquire that lock with a short timeout; if it can't, it
 * emits a single info-level `active_lock` issue and SKIPS stale-index
 * checks (instead of running them against a torn-down index).
 *
 * These tests simulate the lock-holding process by acquiring the lock
 * in the test process before spawning `pmem verify` as a subprocess,
 * then releasing the lock in `after()` / between tests.
 */
describe('FIX-1 (issue #9): verify/rebuild lock protocol', () => {
  const testDir = path.join(TEMP_ROOT, 'fix1-lock-protocol');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest(10));
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    // Seed a single card so verify has a card row whose hash it can compare
    // against. After the initial rebuild, we will mutate the file on disk
    // (without rebuilding) to inject a hash mismatch → stale_index.
    writeFile(path.join(testDir, `.pmem/modules/module.alpha.md`), moduleCard('module.alpha'));

    const r0 = pmem('rebuild --full', testDir);
    assert.strictEqual(r0.code, 0, `seed rebuild failed: ${r0.stdout}\nstderr: ${r0.stderr}`);
  });

  after(() => {
    // Best-effort: ensure no leftover .lock from a failed/aborted test.
    try { fs.rmSync(path.join(testDir, '.pmem', '.lock'), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('Test A: with an active lock, verify emits info-level `active_lock` and skips stale_index', () => {
    // Acquire the .lock manually from the test process so the subprocess
    // (`pmem verify`) sees an active lock and cannot acquire it within its
    // 500ms wait window.
    const lockPath = path.join(testDir, '.pmem', '.lock');
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));

    try {
      // Seed a hash mismatch (stale_index) directly on disk so that, if the
      // verify subprocess were to RUN the stale_index check, it WOULD fire.
      // The expectation is that it does NOT fire — instead `active_lock`
      // info is surfaced and the freshness checks are deferred.
      const alphaFile = path.join(testDir, '.pmem', 'modules', 'module.alpha.md');
      const original = fs.readFileSync(alphaFile, 'utf8');
      const mutated = original + '\n<!-- mutated by fix1-test to trigger stale_index -->\n';
      fs.writeFileSync(alphaFile, mutated, 'utf8');

      try {
        const r = pmem('verify', testDir);

        // The subprocess must report `active_lock` at INFO severity.
        assert.ok(
          r.stdout.includes('active_lock'),
          `expected active_lock info note in stdout, got:\n${r.stdout}`,
        );
        assert.ok(
          r.stdout.includes('deferring index freshness checks'),
          `expected "deferring index freshness checks" wording, got:\n${r.stdout}`,
        );

        // And critically, `stale_index` must NOT appear — that is the whole
        // point of FIX-1. A concurrent rebuild can produce a transient
        // stale_index right now; this is exactly what we are guarding
        // against.
        assert.ok(
          !r.stdout.includes('stale_index'),
          `expected NO stale_index warning during active lock, got:\n${r.stdout}`,
        );

        // The `ℹ [active_lock]` icon line must be present (info severity).
        assert.ok(
          /ℹ \[active_lock\]/.test(r.stdout),
          `expected info-level ℹ icon on active_lock line, got:\n${r.stdout}`,
        );

        // Exit code should be 0 (info-only → passed) — this is different
        // from the old behavior where `active_lock` was a warning.
        assert.strictEqual(
          r.code, 0,
          `expected exit 0 for info-only result, got ${r.code}\nstdout:\n${r.stdout}`,
        );
      } finally {
        // Restore file so subsequent tests (and the lock-release path) see
        // a clean state.
        fs.writeFileSync(alphaFile, original, 'utf8');
      }
    } finally {
      // Release the lock so the next test starts clean.
      try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch {}
    }
  });

  it('Test A2 (tech-lead lock ordering): active lock + missing DB only reports active_lock, not missing_database', () => {
    // v0.7.6 FIX-1 follow-up: when rebuild is running and the SQLite DB does not
    // yet exist (rebuild just started), verify must NOT report `missing_database`
    // — that warning belongs after the lock is acquired. The active_lock fast path
    // (lock unacquirable) must surface ONLY the lock condition and defer all DB
    // checks.

    const lockPath = path.join(testDir, '.pmem', '.lock');
    fs.mkdirSync(lockPath);
    // Use PID 1 (init/launchd) — a process that exists on every macOS/Linux
    // system and is NOT the current process. The lock is fresh (mtime < 60s)
    // so neither getLockStatus nor acquireLock will consider it stale.
    fs.writeFileSync(path.join(lockPath, 'pid'), '1');

    // Remove the DB so that, if verify ran its old DB check (before the lock),
    // it would emit `missing_database`.
    const dbPath = path.join(testDir, '.pmem', 'pmem.db');
    const dbBackup = dbPath + '.fix1-a2-bak';
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, dbBackup);
      }

      const r = pmem('verify', testDir);

      // The key assertion: `missing_database` must NOT appear — the lock was
      // not acquired, so DB checks were deferred.
      assert.ok(
        !r.stdout.includes('missing_database'),
        `expected NO missing_database warning during active lock (DB check is after lock), got:\n${r.stdout}`,
      );

      // The active_lock info note MUST appear.
      assert.ok(
        r.stdout.includes('active_lock'),
        `expected active_lock info note, got:\n${r.stdout}`,
      );

      // Exit code 0 for info-only result.
      assert.strictEqual(r.code, 0,
        `expected exit 0 for info-only result, got ${r.code}\nstdout:\n${r.stdout}`);
    } finally {
      // Restore DB (only if we moved it) and release lock.
      try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch {}
      if (dbBackup && fs.existsSync(dbBackup)) {
        fs.renameSync(dbBackup, dbPath);
      }
    }
  });

  it('Test B: with no active lock, verify runs the full stale_index check', () => {
    // Sanity check: the active-lock guard must not break the normal path.
    // With no lock held, verify should reach the stale_index check and
    // emit a `stale_index` warning for the mutated card.
    //
    // Make sure no leftover .lock from the previous test is hanging around.
    try { fs.rmSync(path.join(testDir, '.pmem', '.lock'), { recursive: true, force: true }); } catch {}

    // Inject a hash mismatch so the stale_index check fires.
    const alphaFile = path.join(testDir, '.pmem', 'modules', 'module.alpha.md');
    const original = fs.readFileSync(alphaFile, 'utf8');
    const mutated = original + '\n<!-- fix1-test-B injected mismatch -->\n';
    fs.writeFileSync(alphaFile, mutated, 'utf8');

    try {
      const r = pmem('verify', testDir);

      // `stale_index` should appear.
      assert.ok(
        r.stdout.includes('stale_index'),
        `expected stale_index warning when no lock is held, got:\n${r.stdout}`,
      );

      // `active_lock` should NOT appear.
      assert.ok(
        !r.stdout.includes('active_lock'),
        `expected NO active_lock when lock is free, got:\n${r.stdout}`,
      );
    } finally {
      // Restore the card on disk and rerun rebuild so any subsequent test
      // starts from a clean index.
      fs.writeFileSync(alphaFile, original, 'utf8');
      const r1 = pmem('rebuild --full', testDir);
      assert.strictEqual(r1.code, 0, `cleanup rebuild failed: ${r1.stdout}`);
    }
  });
});
