/**
 * Tests for issue #10 fix U7:
 *   `pmem relations <CARD_ID>` lists all edges where the card is either
 *   endpoint, grouped by direction. Designed for triaging the
 *   `too_many_relations` warning emitted by `pmem verify`.
 *
 * Pattern matches rebuild.test.ts: spin up a temp project, init/rebuild
 * to populate the SQLite DB, then call `pmem relations ... --format json`
 * and assert on the structured output.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-relations-test-${Date.now()}`);

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

function makeManifest(): string {
  return `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: relations-test
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
    - .pmem/tasks/**/*.md
    - .pmem/decisions/**/*.md
    - .pmem/features/**/*.md
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
    feature: 1000
    decision: 1000
  max_sections:
    module: 8
    feature: 8
    decision: 6
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

function card(id: string, type: string, extraFm: string = ''): string {
  return `---
id: ${id}
type: ${type}
status: active
${extraFm}---
# ${id}
`;
}

function injectEdge(testDir: string, fromId: string, toId: string, type: string, source: string, confidence: number): void {
  const dbPath = path.join(testDir, '.pmem', 'pmem.db');
  const scriptPath = path.join(os.tmpdir(), `pmem-relations-inject-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  const betterSqlitePath = path.resolve(__dirname, '../../node_modules/better-sqlite3');
  const script = `const Database = require(${JSON.stringify(betterSqlitePath)});
const db = new Database(${JSON.stringify(dbPath)});
db.prepare("INSERT INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
  .run(${JSON.stringify(fromId)}, ${JSON.stringify(toId)}, ${JSON.stringify(type)}, ${JSON.stringify(source)}, ${JSON.stringify(confidence)}, new Date().toISOString(), new Date().toISOString());
db.close();`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    execSync(`node ${JSON.stringify(scriptPath)}`, { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

describe('pmem relations (issue #10 U7)', () => {
  const testDir = path.join(TEMP_ROOT, 'relations');

  before(() => {
    const pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    fs.mkdirSync(path.join(pmemDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(pmemDir, 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(pmemDir, 'features'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('card with no relations returns empty arrays and total: 0', () => {
    const subDir = path.join(TEMP_ROOT, 'empty');
    const pmemDir = path.join(subDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');
    writeFile(path.join(pmemDir, 'modules', 'module.Isolated.md'),
      card('module.Isolated', 'module'));

    const rInit = pmem('rebuild --full', subDir);
    assert.strictEqual(rInit.code, 0, `rebuild failed: ${rInit.stdout}\n${rInit.stderr}`);

    const r = pmem('relations module.Isolated --format json', subDir);
    assert.strictEqual(r.code, 0, `relations failed: ${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.card_id, 'module.Isolated');
    assert.deepStrictEqual(out.outgoing, []);
    assert.deepStrictEqual(out.incoming, []);
    assert.strictEqual(out.total, 0);
    assert.deepStrictEqual(out.summary_by_type, {});
    assert.deepStrictEqual(out.summary_by_source, {});
    assert.deepStrictEqual(out.pruning_candidates, []);
  });

  it('card with 5 outgoing + 3 incoming reports total: 8 with direction grouping', () => {
    const subDir = path.join(TEMP_ROOT, 'mixed');
    const pmemDir = path.join(subDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    writeFile(path.join(pmemDir, 'modules', 'module.Hub.md'),
      card('module.Hub', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.A.md'),
      card('module.A', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.B.md'),
      card('module.B', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.C.md'),
      card('module.C', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.D.md'),
      card('module.D', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.E.md'),
      card('module.E', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.X.md'),
      card('module.X', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Y.md'),
      card('module.Y', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Z.md'),
      card('module.Z', 'module'));

    const rInit = pmem('rebuild --full', subDir);
    assert.strictEqual(rInit.code, 0, `rebuild failed: ${rInit.stdout}\n${rInit.stderr}`);

    // Inject 5 outgoing (Hub -> A..E) and 3 incoming (X,Y,Z -> Hub).
    for (const t of ['module.A', 'module.B', 'module.C', 'module.D', 'module.E']) {
      injectEdge(subDir, 'module.Hub', t, 'depends_on', 'explicit', 1.0);
    }
    for (const f of ['module.X', 'module.Y', 'module.Z']) {
      injectEdge(subDir, f, 'module.Hub', 'depends_on', 'explicit', 1.0);
    }

    const r = pmem('relations module.Hub --format json', subDir);
    assert.strictEqual(r.code, 0, `relations failed: ${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.card_id, 'module.Hub');
    assert.strictEqual(out.outgoing.length, 5, `expected 5 outgoing, got ${out.outgoing.length}`);
    assert.strictEqual(out.incoming.length, 3, `expected 3 incoming, got ${out.incoming.length}`);
    assert.strictEqual(out.total, 8);

    const outTargets = out.outgoing.map((e: any) => e.to_id).sort();
    assert.deepStrictEqual(outTargets, ['module.A', 'module.B', 'module.C', 'module.D', 'module.E']);
    const inSources = out.incoming.map((e: any) => e.from_id).sort();
    assert.deepStrictEqual(inSources, ['module.X', 'module.Y', 'module.Z']);

    assert.strictEqual(out.summary_by_type['depends_on'], 8);
    assert.strictEqual(out.summary_by_source['explicit'], 8);
    assert.deepStrictEqual(out.pruning_candidates, []);
  });

  it('--type depends_on filter returns only edges of that type', () => {
    const subDir = path.join(TEMP_ROOT, 'filter-type');
    const pmemDir = path.join(subDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    writeFile(path.join(pmemDir, 'modules', 'module.Center.md'),
      card('module.Center', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Dep.md'),
      card('module.Dep', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Rel.md'),
      card('module.Rel', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Ref.md'),
      card('module.Ref', 'module'));

    const rInit = pmem('rebuild --full', subDir);
    assert.strictEqual(rInit.code, 0, `rebuild failed: ${rInit.stdout}\n${rInit.stderr}`);

    injectEdge(subDir, 'module.Center', 'module.Dep', 'depends_on', 'explicit', 1.0);
    injectEdge(subDir, 'module.Center', 'module.Rel', 'related_to', 'explicit', 1.0);
    injectEdge(subDir, 'module.Ref', 'module.Center', 'references', 'mention', 1.0);

    const r = pmem('relations module.Center --type depends_on --format json', subDir);
    assert.strictEqual(r.code, 0, `relations failed: ${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.total, 1, `expected 1 edge after type filter, got ${out.total}`);
    assert.strictEqual(out.outgoing.length, 1);
    assert.strictEqual(out.outgoing[0].type, 'depends_on');
    assert.strictEqual(out.outgoing[0].to_id, 'module.Dep');
    assert.deepStrictEqual(out.incoming, []);
    assert.strictEqual(out.summary_by_type['depends_on'], 1);
    assert.strictEqual(out.summary_by_type['related_to'], undefined);
    assert.strictEqual(out.summary_by_type['references'], undefined);
  });

  it('--source inferred filter returns only inferred edges', () => {
    const subDir = path.join(TEMP_ROOT, 'filter-source');
    const pmemDir = path.join(subDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    writeFile(path.join(pmemDir, 'modules', 'module.Foo.md'),
      card('module.Foo', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Inf1.md'),
      card('module.Inf1', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Inf2.md'),
      card('module.Inf2', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.Exp1.md'),
      card('module.Exp1', 'module'));

    const rInit = pmem('rebuild --full', subDir);
    assert.strictEqual(rInit.code, 0, `rebuild failed: ${rInit.stdout}\n${rInit.stderr}`);

    injectEdge(subDir, 'module.Foo', 'module.Inf1', 'related_to', 'inferred', 0.6);
    injectEdge(subDir, 'module.Foo', 'module.Inf2', 'depends_on', 'inferred', 0.55);
    injectEdge(subDir, 'module.Foo', 'module.Exp1', 'depends_on', 'explicit', 1.0);

    const r = pmem('relations module.Foo --source inferred --format json', subDir);
    assert.strictEqual(r.code, 0, `relations failed: ${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.total, 2, `expected 2 inferred edges, got ${out.total}`);
    assert.strictEqual(out.outgoing.length, 2);
    for (const e of out.outgoing) {
      assert.strictEqual(e.source, 'inferred');
    }
    const targets = out.outgoing.map((e: any) => e.to_id).sort();
    assert.deepStrictEqual(targets, ['module.Inf1', 'module.Inf2']);
    assert.strictEqual(out.summary_by_source['inferred'], 2);
    assert.strictEqual(out.summary_by_source['explicit'], undefined);
  });

  it('pruning candidates correctly flag inferred edges and low-confidence (<0.5) edges', () => {
    const subDir = path.join(TEMP_ROOT, 'pruning');
    const pmemDir = path.join(subDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    writeFile(path.join(pmemDir, 'index.md'), '# Index\n');
    writeFile(path.join(pmemDir, 'state.md'), '# State\n');
    writeFile(path.join(pmemDir, 'next.md'), '# Next\n');

    writeFile(path.join(pmemDir, 'modules', 'module.Subject.md'),
      card('module.Subject', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.InfOut.md'),
      card('module.InfOut', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.LowConfOut.md'),
      card('module.LowConfOut', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.CleanOut.md'),
      card('module.CleanOut', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.InfIn.md'),
      card('module.InfIn', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.LowConfIn.md'),
      card('module.LowConfIn', 'module'));
    writeFile(path.join(pmemDir, 'modules', 'module.CleanIn.md'),
      card('module.CleanIn', 'module'));

    const rInit = pmem('rebuild --full', subDir);
    assert.strictEqual(rInit.code, 0, `rebuild failed: ${rInit.stdout}\n${rInit.stderr}`);

    // Outgoing: 1 inferred (prune), 1 low-conf (prune), 1 clean (keep)
    injectEdge(subDir, 'module.Subject', 'module.InfOut', 'related_to', 'inferred', 0.8);
    injectEdge(subDir, 'module.Subject', 'module.LowConfOut', 'related_to', 'explicit', 0.3);
    injectEdge(subDir, 'module.Subject', 'module.CleanOut', 'depends_on', 'explicit', 1.0);
    // Incoming: 1 inferred (prune), 1 low-conf (prune), 1 clean (keep)
    injectEdge(subDir, 'module.InfIn', 'module.Subject', 'related_to', 'inferred', 0.9);
    injectEdge(subDir, 'module.LowConfIn', 'module.Subject', 'related_to', 'mention', 0.2);
    injectEdge(subDir, 'module.CleanIn', 'module.Subject', 'depends_on', 'explicit', 1.0);

    const r = pmem('relations module.Subject --format json', subDir);
    assert.strictEqual(r.code, 0, `relations failed: ${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);

    assert.strictEqual(out.total, 6, `expected total 6, got ${out.total}`);
    assert.strictEqual(out.outgoing.length, 3);
    assert.strictEqual(out.incoming.length, 3);
    assert.strictEqual(out.pruning_candidates.length, 4,
      `expected 4 pruning candidates (2 inferred + 2 low-conf), got ${out.pruning_candidates.length}`);

    const reasons = out.pruning_candidates.map((p: any) => `${p.direction}:${p.reason}:${p.other_id}`).sort();
    assert.deepStrictEqual(reasons, [
      'in:inferred:module.InfIn',
      'in:low_confidence:module.LowConfIn',
      'out:inferred:module.InfOut',
      'out:low_confidence:module.LowConfOut',
    ]);

    // Clean edges must NOT be in pruning candidates
    const prunedOthers = out.pruning_candidates.map((p: any) => p.other_id).sort();
    assert.ok(!prunedOthers.includes('module.CleanOut'),
      `clean outgoing must not be pruning candidate: ${JSON.stringify(prunedOthers)}`);
    assert.ok(!prunedOthers.includes('module.CleanIn'),
      `clean incoming must not be pruning candidate: ${JSON.stringify(prunedOthers)}`);
  });
});