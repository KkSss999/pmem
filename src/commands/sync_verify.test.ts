import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-sync-test-${Date.now()}`);

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

function initGit(cwd: string) {
  execSync('git init', { cwd });
  execSync('git config user.name "Test User"', { cwd });
  execSync('git config user.email "test@example.com"', { cwd });
}

function commitAll(cwd: string, msg: string = "initial") {
  try {
    execSync('git add .', { cwd });
    execSync('git commit -m "' + msg + '"', { cwd });
  } catch {
    // Ignore if nothing to commit
  }
}

function writeManifest(pmemDir: string, extra: string = '') {
  const manifestPath = path.join(pmemDir, 'manifest.yml');
  const cardPolicySection = extra.includes('card_policy:') ? '' : `card_policy:
  id_pattern: ^(project|module|feature|task|decision|trace|risk|assumption|resource|integration)\\.[a-z0-9._-]+$
  max_tokens:
    module: 1000
    feature: 1000
    decision: 1000
    task: 6
    trace: 1000
  max_sections:
    module: 8
    feature: 8
    decision: 6
    task: 6
  warn_when_related_count_gt: 12`;

  const yml = `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: sync-project
  language: zh-CN
  status: active
memory_status:
  completeness: partial
  initialized_mode: guided
  dirty: false
  dirty_since: null
  dirty_reason: null
source_of_truth:
  type: markdown_cards
  path: .pmem
  card_globs:
    - .pmem/modules/**/*.md
    - .pmem/features/**/*.md
    - .pmem/decisions/**/*.md
    - .pmem/tasks/**/*.md
    - .pmem/traces/**/*.md
    - .pmem/risks/**/*.md
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
    note: Deferred to SQLite runtime in v0.3
cli:
  default_format: compact
  supported_formats:
    - compact
    - json
    - paths
    - pack
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
  ignore_patterns:
    - node_modules/**
    - dist/**
    - build/**
    - '*.lock'
    - '*.log'
  trace_policy:
    require_meaningful_change: true
    require_summary: true
    require_related_node: true
${cardPolicySection}
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
${extra}
`;
  fs.writeFileSync(manifestPath, yml, 'utf8');
}

describe('pmem sync and verify integration tests', () => {
  const cwd = path.join(TEMP_ROOT, 'sync-project');

  before(() => {
    fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
    initGit(cwd);
    writeManifest(path.join(cwd, '.pmem'));
    
    // Create AGENTS.md for verify checks
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Agents', 'utf8');
    
    // Create a mock source file
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), 'console.log("hello");', 'utf8');
    
    // Create a card matching index.ts
    fs.mkdirSync(path.join(cwd, '.pmem', 'modules'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.pmem', 'modules', 'module.core.md'), `---
id: module.core
type: module
title: "Core Module"
status: active
updated: "2026-06-01T00:00:00.000Z"
source_files:
  - src/index.ts
---
# Core Module
`, 'utf8');

    commitAll(cwd, "initial commit");
    // Initial rebuild
    pmem('rebuild --full', cwd);
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('pmem sync with no changes should be clean', () => {
    const r = pmem('sync', cwd);
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('No changed files detected'));
  });

  it('pmem sync with changes but no summary auto-marks dirty and prints recommendation', () => {
    // Modify index.ts
    fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), 'console.log("hello 2");', 'utf8');
    
    const r = pmem('sync', cwd);
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('Auto-marked 1 card(s) as dirty'));
    assert.ok(r.stdout.includes('Recommended: run `pmem sync -s "<summary>" -n "<next>"`'));
    
    // Manifest memory_status.dirty should be true
    const manifest = fs.readFileSync(path.join(cwd, '.pmem', 'manifest.yml'), 'utf8');
    assert.ok(manifest.includes('dirty: true'));
    
    // .dirty file should exist
    assert.ok(fs.existsSync(path.join(cwd, '.pmem', '.dirty')));
  });

  it('pmem sync with changes and summary auto-confirms and updates indexes', () => {
    const r = pmem('sync -s "modified index.ts to log hello 2" -n "implement next feature"', cwd);
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('Memory sync and update completed'));
    
    // Manifest dirty should be false
    const manifest = fs.readFileSync(path.join(cwd, '.pmem', 'manifest.yml'), 'utf8');
    assert.ok(manifest.includes('dirty: false'));
    
    // .dirty file should be cleaned up
    assert.ok(!fs.existsSync(path.join(cwd, '.pmem', '.dirty')));
    
    // Trace file should be created
    const tracesDir = path.join(cwd, '.pmem', 'traces');
    const traces = fs.readdirSync(tracesDir);
    assert.strictEqual(traces.length, 1);
    assert.ok(traces[0].endsWith('.md'));
    
    // next.md should be updated
    const nextContent = fs.readFileSync(path.join(cwd, '.pmem', 'next.md'), 'utf8');
    assert.ok(nextContent.includes('implement next feature'));
  });

  it('pmem verify --fix-stale (or --fix) updates last_verified timestamp', () => {
    // 1. Re-commit so repo status is clean but make mtime of src/index.ts newer than the card's updated time.
    // Let's modify updated time of card inside SQLite or just backdate card in markdown and rebuild.
    // Currently the card's updated is 2026-06-01T00:00:00.000Z.
    // The mtime of src/index.ts is current time (newer).
    // So the card is stale!
    // Running verify should fail / show stale warning
    const rVerify = pmem('verify', cwd);
    assert.ok(rVerify.stdout.includes('stale_memory'));
    
    // Run verify --fix-stale
    const rFix = pmem('verify --fix-stale', cwd);
    assert.strictEqual(rFix.code, 0);
    assert.ok(rFix.stdout.includes('Updated last_verified timestamp for card: module.core'));
    
    const rVerify2 = pmem('verify', cwd);
    assert.ok(rVerify2.stdout.includes('Score: 100/100') || rVerify2.stdout.includes('Memory verification passed'));
  });

  it('pmem verify relaxed token count warning policy', () => {
    // Create a card with token count > 6 (limit is 6 for task)
    fs.mkdirSync(path.join(cwd, '.pmem', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.pmem', 'tasks', 'task.large.md'), `---
id: task.large
type: task
title: "Large Task"
status: active
updated: "2026-06-01T00:00:00.000Z"
---
# Large Task
One two three four five six seven eight nine ten tactics.
`, 'utf8');
    pmem('rebuild', cwd);

    // Running verify should warn about card_too_large and score < 100
    const rVerify = pmem('verify', cwd);
    assert.ok(rVerify.stdout.includes('card_too_large'));

    assert.ok(rVerify.stdout.includes('Score: 95/100'));

    // Running verify --relaxed should bypass/relax it to info note and score should be 100/100
    const rRelaxed = pmem('verify --relaxed', cwd);
    assert.ok(rRelaxed.stdout.includes('card_too_large_relaxed'));
    assert.ok(rRelaxed.stdout.includes('Score: 100/100'));

    // Update frontmatter to have 'token_policy: relaxed'
    fs.writeFileSync(path.join(cwd, '.pmem', 'tasks', 'task.large.md'), `---
id: task.large
type: task
title: "Large Task"
status: active
token_policy: relaxed
updated: "2026-06-01T00:00:00.000Z"
---
# Large Task
One two three four five six seven eight nine ten tactics.
`, 'utf8');
    pmem('rebuild', cwd);

    // Verify should now pass with score 100/100 even without --relaxed flag!
    const rVerifyLocal = pmem('verify', cwd);
    assert.ok(rVerifyLocal.stdout.includes('card_too_large_relaxed'));
    assert.ok(rVerifyLocal.stdout.includes('Score: 100/100'));
    
    // Testing manifest relaxed_cards
    fs.writeFileSync(path.join(cwd, '.pmem', 'tasks', 'task.large.md'), `---
id: task.large
type: task
title: "Large Task"
status: active
updated: "2026-06-01T00:00:00.000Z"
---
# Large Task
One two three four five six seven eight nine ten tactics.
`, 'utf8');
    // Add relaxed_cards to manifest card_policy
    writeManifest(path.join(cwd, '.pmem'), `
card_policy:
  id_pattern: ^(project|module|feature|task|decision|trace|risk|assumption|resource|integration)\\.[a-z0-9._-]+$
  max_tokens:
    module: 1000
    task: 6
  relaxed_cards:
    - task.large
`);
    pmem('rebuild', cwd);

    // Verify should pass with score 100/100 due to manifest relaxed_cards rule!
    const rVerifyManifest = pmem('verify', cwd);
    assert.ok(rVerifyManifest.stdout.includes('card_too_large_relaxed'));
    assert.ok(rVerifyManifest.stdout.includes('Score: 100/100'));
  });
});
