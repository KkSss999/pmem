import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { contextQuery } from '../core/query/context';
import { captureCore } from '../core/capture';
import { validateCaptureInputs } from './security';
import { handleMcpTool, listMcpTools } from './server';
import { Pmem } from '../runtime';

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


  describe('MCP Runtime API routing', () => {
    let runtime: Pmem;

    before(async () => {
      runtime = await Pmem.open({ root: testDir });
    });

    after(async () => {
      await runtime.close();
    });

    it('routes read tools through one Pmem runtime and preserves MCP response metadata', async () => {
      const recall = await handleMcpTool(runtime, 'readonly', 'pmem_recall', {});
      assert.strictEqual(recall.isError, undefined);
      const recallBody = JSON.parse(recall.content[0].text);
      assert.strictEqual(recallBody.schema_version, '1.0');
      assert.strictEqual(recallBody.project, 'capture-workspace');

      const ask = await handleMcpTool(runtime, 'readonly', 'pmem_ask', { query: 'core' });
      assert.strictEqual(ask.isError, undefined);
      const askBody = JSON.parse(ask.content[0].text);
      assert.strictEqual(askBody.schema_version, '1.0');
      assert.ok(Array.isArray(askBody.matched));

      const context = await handleMcpTool(runtime, 'readonly', 'pmem_context', { task: 'core module' });
      assert.strictEqual(context.isError, undefined);
      const contextBody = JSON.parse(context.content[0].text);
      assert.strictEqual(contextBody.schema_version, '1.0');
      assert.strictEqual(contextBody.task, 'core module');
    });

    it('preserves read-only defaults and lists write tools only in append-only mode', () => {
      const readonlyNames = listMcpTools('readonly').map(tool => tool.name);
      assert.deepStrictEqual(readonlyNames, ['pmem_recall', 'pmem_ask', 'pmem_related', 'pmem_status', 'pmem_context']);

      const appendOnlyNames = listMcpTools('append-only').map(tool => tool.name);
      assert.ok(appendOnlyNames.includes('pmem_capture'));
      assert.ok(appendOnlyNames.includes('pmem_observe'));
      assert.ok(appendOnlyNames.includes('pmem_forget'));
    });

    it('gates observe and forget in readonly mode', async () => {
      for (const [name, args] of [
        ['pmem_observe', { summary: 'blocked' }],
        ['pmem_forget', { id: 'memory-id', reason: 'blocked' }],
      ] as const) {
        const response = await handleMcpTool(runtime, 'readonly', name, args);
        assert.strictEqual(response.isError, true);
        assert.match(response.content[0].text, /append-only write mode/);
      }
    });

    it('routes structured observe and forget events through Runtime', async () => {
      const at = '2026-07-22T12:34:56.000Z';
      const observe = await handleMcpTool(runtime, 'append-only', 'pmem_observe', {
        file: 'src/index.ts',
        summary: 'Observed an MCP adapter change',
        action: 'modified',
        metadata: { source: 'test' },
        at,
      });
      assert.strictEqual(observe.isError, undefined);
      const observed = JSON.parse(observe.content[0].text);
      assert.strictEqual(observed.schema_version, '1.0');
      assert.strictEqual(observed.type, 'observe');
      assert.strictEqual(observed.created_at, at);
      assert.strictEqual(observed.content_trust, undefined);
      assert.strictEqual(typeof observed.requires_confirmation, 'boolean');

      const forget = await handleMcpTool(runtime, 'append-only', 'pmem_forget', {
        id: observed.id,
        reason: 'Superseded by a later observation',
        metadata: { actor: 'test' },
      });
      assert.strictEqual(forget.isError, undefined);
      const forgotten = JSON.parse(forget.content[0].text);
      assert.strictEqual(forgotten.schema_version, '1.0');
      assert.strictEqual(forgotten.type, 'forget');
      assert.strictEqual(forgotten.scope, observed.scope);
      assert.strictEqual(forgotten.content_trust, undefined);
    });

    it('validates structured write tool inputs', async () => {
      const invalidObserve = await handleMcpTool(runtime, 'append-only', 'pmem_observe', {
        summary: '',
        unexpected: true,
      });
      assert.strictEqual(invalidObserve.isError, true);
      assert.match(invalidObserve.content[0].text, /unknown parameter/);

      const invalidForget = await handleMcpTool(runtime, 'append-only', 'pmem_forget', {
        id: 'x',
        reason: 'forget',
        at: 'tomorrow',
      });
      assert.strictEqual(invalidForget.isError, true);
      assert.match(invalidForget.content[0].text, /ISO-8601/);
    });

    it('uses the Runtime root for programmatic MCP calls outside process.cwd', async () => {
      const previous = process.cwd();
      process.chdir(os.tmpdir());
      try {
        const response = await handleMcpTool(runtime, 'readonly', 'pmem_recall', {});
        assert.strictEqual(response.isError, undefined);
        assert.strictEqual(JSON.parse(response.content[0].text).project, 'capture-workspace');
      } finally {
        process.chdir(previous);
      }
    });

    it('keeps pmem_capture gated by write mode and routes append-only capture through runtime', async () => {
      const readonly = await handleMcpTool(runtime, 'readonly', 'pmem_capture', { summary: 'Readonly blocked' });
      assert.strictEqual(readonly.isError, true);
      assert.match(readonly.content[0].text, /append-only write mode/);

      const appendOnly = await handleMcpTool(runtime, 'append-only', 'pmem_capture', {
        summary: 'Runtime MCP capture',
        next: 'Verify runtime capture routing'
      });
      assert.strictEqual(appendOnly.isError, undefined);
      const body = JSON.parse(appendOnly.content[0].text);
      assert.strictEqual(body.schema_version, '1.0');
      assert.strictEqual(body.content_trust, undefined, 'top-level capture result is not card content');
      assert.ok(body.success);
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
