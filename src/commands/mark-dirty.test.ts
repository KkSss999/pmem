/**
 * v0.7.6 (issue #10): Tests for `pmem mark-dirty --auto` agent contract.
 *
 * Verifies:
 *  - JSON output schema (state: 'no_related_cards' | 'marked_dirty' | 'no_pmem')
 *  - Exit code 0 for the no-op case (changed files exist but no cards match),
 *    so documented `&&` chains keep running.
 *  - Exit code 0 for the marked_dirty case.
 *
 * Uses child_process.execSync to drive the real CLI against `dist/index.js`,
 * matching the pattern from new.test.ts / rebuild.test.ts / sync_verify.test.ts.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-markdirty-test-${Date.now()}`);

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

function commitAll(cwd: string, msg: string = 'initial') {
  try {
    execSync('git add .', { cwd });
    execSync('git commit -m "' + msg + '"', { cwd });
  } catch {
    // Ignore if nothing to commit
  }
}

function writeManifest(pmemDir: string) {
  const manifestPath = path.join(pmemDir, 'manifest.yml');
  const yml = `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: mark-dirty-test
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
card_policy:
  id_pattern: ^(project|module|feature|task|decision|trace|risk|assumption|resource|integration)\\.[a-z0-9._-]+$
  max_tokens:
    module: 1200
    feature: 1000
    decision: 1000
    task: 800
    trace: 1000
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
  fs.writeFileSync(manifestPath, yml, 'utf8');
}

// ── Test suite ────────────────────────────────────────────────

describe('pmem mark-dirty --auto (issue #10 agent contract)', () => {
  describe('JSON output: no related cards case (the bug)', () => {
    const cwd = path.join(TEMP_ROOT, 'no-related-cards');

    before(() => {
      fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
      initGit(cwd);
      writeManifest(path.join(cwd, '.pmem'));

      // Create a tracked source file that has NO matching card.
      // git status --porcelain -u will see this as modified.
      fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'src', 'untracked-area.ts'), 'console.log("init");', 'utf8');

      // Initial commit so the project has a baseline.
      commitAll(cwd, 'initial commit');

      // Build SQLite indexes so pmem.db exists.
      pmem('rebuild --full', cwd);

      // Now modify the file so git --porcelain reports it as changed,
      // but no card references it (so no card should be marked dirty).
      fs.writeFileSync(path.join(cwd, 'src', 'untracked-area.ts'), 'console.log("changed");', 'utf8');
    });

    after(() => {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
    });

    it('exits 0 (not 1) and emits state=no_related_cards JSON', () => {
      const r = pmem('mark-dirty --auto --format json', cwd);
      assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}\n${r.stderr}`);

      // Locate the JSON payload in stdout (compact mode also prints extra lines;
      // JSON is the last console.log call so it should be parseable in isolation).
      const jsonMatch = r.stdout.match(/\{[\s\S]*\}/);
      assert.ok(jsonMatch, `expected JSON object in stdout, got: ${r.stdout}`);

      const payload = JSON.parse(jsonMatch![0]);
      assert.strictEqual(payload.state, 'no_related_cards',
        `expected state=no_related_cards, got: ${payload.state}`);
      assert.deepStrictEqual(payload.marked_card_ids, [],
        `expected empty marked_card_ids, got: ${JSON.stringify(payload.marked_card_ids)}`);
      assert.strictEqual(payload.command, 'mark-dirty --auto');
      assert.ok(Array.isArray(payload.changed_files),
        `expected changed_files array, got: ${typeof payload.changed_files}`);
      assert.ok(Array.isArray(payload.next_actions),
        `expected next_actions array`);
    });

    it('compact mode also exits 0 (no process.exit(1))', () => {
      const r = pmem('mark-dirty --auto', cwd);
      assert.strictEqual(r.code, 0,
        `expected exit 0 in compact mode too, got ${r.code}: ${r.stdout}\n${r.stderr}`);
      assert.ok(r.stdout.includes('No related cards found for changed files.'),
        `expected compact "No related cards" message in: ${r.stdout}`);
    });
  });

  describe('JSON output: marked_dirty case', () => {
    const cwd = path.join(TEMP_ROOT, 'marked-dirty');

    before(() => {
      fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
      initGit(cwd);
      writeManifest(path.join(cwd, '.pmem'));

      // Create a tracked source file with a matching module card.
      fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'src', 'core.ts'), 'export const x = 1;', 'utf8');

      // Create a card that references src/core.ts.
      fs.mkdirSync(path.join(cwd, '.pmem', 'modules'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.pmem', 'modules', 'module.core.md'),
        `---
id: module.core
type: module
title: "Core Module"
status: active
updated: "2026-06-01T00:00:00.000Z"
source_files:
  - src/core.ts
---
# Core Module
`, 'utf8');

      commitAll(cwd, 'initial commit');
      pmem('rebuild --full', cwd);

      // Modify the matched file so mark-dirty --auto should mark module.core dirty.
      fs.writeFileSync(path.join(cwd, 'src', 'core.ts'), 'export const x = 2;', 'utf8');
    });

    after(() => {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
    });

    it('exits 0 and emits state=marked_dirty JSON with the matching card_id', () => {
      const r = pmem('mark-dirty --auto --format json', cwd);
      assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}\n${r.stderr}`);

      const jsonMatch = r.stdout.match(/\{[\s\S]*\}/);
      assert.ok(jsonMatch, `expected JSON object in stdout, got: ${r.stdout}`);

      const payload = JSON.parse(jsonMatch![0]);
      assert.strictEqual(payload.state, 'marked_dirty',
        `expected state=marked_dirty, got: ${payload.state}`);
      assert.ok(Array.isArray(payload.marked_card_ids) && payload.marked_card_ids.length >= 1,
        `expected non-empty marked_card_ids, got: ${JSON.stringify(payload.marked_card_ids)}`);
      assert.ok(payload.marked_card_ids.includes('module.core'),
        `expected marked_card_ids to include module.core, got: ${JSON.stringify(payload.marked_card_ids)}`);
      assert.strictEqual(payload.command, 'mark-dirty --auto');
      assert.ok(Array.isArray(payload.changed_files),
        `expected changed_files array`);
      assert.ok(Array.isArray(payload.next_actions),
        `expected next_actions array`);
    });

    it('compact mode keeps the existing message and exits 0', () => {
      const r = pmem('mark-dirty --auto', cwd);
      assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}\n${r.stderr}`);
      assert.ok(r.stdout.includes('Auto-marked'),
        `expected "Auto-marked" message in compact output: ${r.stdout}`);
    });
  });
});

// Clean up temp root after all tests
after(() => {
  try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
});