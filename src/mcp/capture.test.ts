import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { contextQuery } from '../core/query/context';
import { captureCore } from '../core/capture';
import { validateCaptureInputs } from './security';

const TEMP_ROOT = path.join(os.tmpdir(), `pmem-capture-test-${Date.now()}`);
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');

describe('pmem context & capture functionality', () => {
  let testDir: string;
  let pmemDir: string;
  let oldCwd: string;

  before(() => {
    testDir = path.join(TEMP_ROOT, 'capture-workspace');
    pmemDir = path.join(testDir, '.pmem');
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });

    const { execSync } = require('child_process');
    try {
      execSync('git init -q', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "test"', { cwd: testDir });
    } catch {}

    // Minimal project configuration
    fs.writeFileSync(path.join(pmemDir, 'manifest.yml'), `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: capture-workspace
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
card_policy:
  id_pattern: ^(module)\\\\.[a-z0-9._-]+$
  max_tokens:
    module: 1000
  max_sections:
    module: 8
  warn_when_related_count_gt: 12
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
schema:
  card_types: [module, feature, decision, task, trace]
  type_dirs:
    module: modules
    trace: traces
  foundational_types: [module]
  evidence_types: [decision, trace]
  default_type: trace
`);

    fs.writeFileSync(path.join(pmemDir, 'index.md'), `# Project Memory Index
## Project
Name: capture-workspace
Stage: Development
Status: active
## Current Focus
Testing capture logic
`);

    fs.writeFileSync(path.join(pmemDir, 'state.md'), `# State
## Overall Status
active
`);

    fs.writeFileSync(path.join(pmemDir, 'next.md'), `# Next Steps
<!-- pmem:next:start -->
- Recommended next step: Original step
<!-- pmem:next:end -->
`);

    fs.writeFileSync(path.join(pmemDir, 'modules', 'module.core.md'), `---
id: module.core
type: module
status: active
source_files: [src/index.ts]
---
# Core Module
`);

    // Create a mock source file
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), `console.log("hello world");\n`);

    // Initialize sqlite db
    try {
      execSync(`node "${PMEM_BIN}" rebuild --full`, { cwd: testDir, stdio: 'ignore', timeout: 10_000 });
    } catch { /* ignore */ }

    // Commit baseline
    try {
      execSync('git add .', { cwd: testDir });
      execSync('git commit -q -m "baseline"', { cwd: testDir });
    } catch {}

    oldCwd = process.cwd();
    process.chdir(testDir);
  });

  after(() => {
    if (oldCwd) {
      process.chdir(oldCwd);
    }
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  describe('validateCaptureInputs', () => {
    it('rejects summary longer than 2000 characters', () => {
      const longSummary = 'A'.repeat(2001);
      assert.throws(
        () => validateCaptureInputs('.pmem', longSummary, 'next'),
        /Security: summary input exceeds max size/
      );
    });

    it('rejects next longer than 2000 characters', () => {
      const longNext = 'B'.repeat(2001);
      assert.throws(
        () => validateCaptureInputs('.pmem', 'summary', longNext),
        /Security: next input exceeds max size/
      );
    });

    it('rejects control characters in summary', () => {
      const maliciousSummary = 'Summary\x00withNull';
      assert.throws(
        () => validateCaptureInputs('.pmem', maliciousSummary, 'next'),
        /Security: summary input contains invalid control characters/
      );
    });

    it('rejects reserved comment markers to prevent injection', () => {
      assert.throws(
        () => validateCaptureInputs('.pmem', '<!-- pmem:next:start --> summary', 'next'),
        /Security: capture input contains reserved pmem marker/
      );
      assert.throws(
        () => validateCaptureInputs('.pmem', 'summary', '<!-- pmem:rules:end --> next'),
        /Security: capture input contains reserved pmem marker/
      );
    });

    it('accepts valid inputs', () => {
      assert.doesNotThrow(() => validateCaptureInputs('.pmem', 'Valid Summary', 'Valid Next Step'));
    });
  });

  describe('contextQuery', () => {
    it('aggregates context and finds relevant files', () => {
      const result = contextQuery('.pmem', 'core module');
      assert.strictEqual(result.task, 'core module');
      assert.strictEqual(result.project_stage, 'Development');
      assert.strictEqual(result.current_focus, 'Testing capture logic');
      
      const paths = result.must_read.map(m => m.path);
      assert.ok(paths.includes('.pmem/state.md'));
      assert.ok(paths.includes('.pmem/next.md'));
    });
  });

  describe('captureCore', () => {
    it('skips writing trace if no files changed', () => {
      const result = captureCore('.pmem', { summary: 'No changes', next: 'Step' });
      assert.ok(result.success);
      assert.strictEqual(result.skipped, true);
    });

    it('writes trace and updates next.md inside managed block when force=true', () => {
      const result = captureCore('.pmem', {
        summary: 'Force sync capture',
        next: 'Write test assertions',
        force: true
      });

      assert.ok(result.success);
      assert.ok(result.tracePath);
      assert.ok(fs.existsSync(result.tracePath));

      const nextContent = fs.readFileSync('.pmem/next.md', 'utf8');
      assert.ok(nextContent.includes('<!-- pmem:next:start -->'));
      assert.ok(nextContent.includes('## Recommended Next Step\nWrite test assertions'));
      assert.ok(nextContent.includes('<!-- pmem:next:end -->'));

      const traceContent = fs.readFileSync(result.tracePath, 'utf8');
      assert.ok(traceContent.includes('diff_hash:'));
      assert.ok(traceContent.includes('# Capture: Force sync capture'));

      const secondResult = captureCore('.pmem', {
        summary: 'Force sync capture',
        next: 'Write test assertions',
        force: false
      });
      assert.ok(secondResult.success);
      assert.strictEqual(secondResult.skipped, true, 'Should skip duplicate diff_hash trace writing');
    });

    it('sanitizes summary name to prevent path traversal in trace creation', () => {
      const result = captureCore('.pmem', {
        summary: '../../evil.md',
        next: 'Traversing',
        force: true
      });

      assert.ok(result.success);
      assert.ok(result.tracePath);
      
      const filename = path.basename(result.tracePath);
      assert.ok(!filename.includes('evil'));
      assert.ok(result.tracePath.startsWith(path.resolve('.pmem', 'traces')));
    });

    it('pmem_capture with malicious summary cannot affect trace filename or write path', () => {
      const result = captureCore('.pmem', {
        summary: '../../module.core.md',
        next: 'Attack summary',
        force: true
      });

      assert.ok(result.success);
      assert.ok(result.tracePath);
      
      const filename = path.basename(result.tracePath);
      assert.ok(!filename.includes('module.core.md'));
      assert.ok(result.tracePath.startsWith(path.resolve('.pmem', 'traces')));
      assert.match(filename, /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}\.md$/);
    });
  });
});
