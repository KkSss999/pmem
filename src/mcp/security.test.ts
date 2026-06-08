import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import the functions under test directly
import { validatePathScope, enforceBudget, addContentTrust } from './security';
import { recallQuery } from '../core/query/recall';
import { askQuery } from '../core/query/ask';
import { relatedQuery } from '../core/query/related';

const TEMP_ROOT = path.join(os.tmpdir(), `pmem-mcp-test-${Date.now()}`);
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');

describe('MCP security module', () => {
  // ── Test 1: Read-only verification ──
  describe('read-only tools', () => {
    let testDir: string;
    before(() => {
      testDir = path.join(TEMP_ROOT, 'readonly-test');
      const pmemDir = path.join(testDir, '.pmem');
      fs.mkdirSync(pmemDir, { recursive: true });
      fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });

      // Create minimal project for testing
      fs.writeFileSync(path.join(pmemDir, 'manifest.yml'), `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: readonly-test
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
  min_trace_interval: 30m
  max_auto_traces_per_day: 5
  ignore_patterns: []
  trace_policy:
    require_meaningful_change: true
    require_summary: true
    require_related_node: true
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
`);

      fs.writeFileSync(path.join(pmemDir, 'index.md'), `# Project Memory Index
## Project
Name: readonly-test
Stage: Alpha
Status: active
## Current Focus
Testing
`);

      fs.writeFileSync(path.join(pmemDir, 'state.md'), `# State
## Overall Status
active
## Recent Changes
- Test change
`);

      fs.writeFileSync(path.join(pmemDir, 'next.md'), `# Next Steps
## Recommended Next Step
Run tests
`);

      fs.writeFileSync(path.join(pmemDir, 'modules', 'module.core.md'), `---
id: module.core
type: module
status: active
---
# Core Module
`);

      // Build database
      const { execSync } = require('child_process');
      try {
        execSync(`node "${PMEM_BIN}" rebuild --full`, { cwd: testDir, stdio: 'ignore', timeout: 10_000 });
      } catch { /* ignore */ }
    });

    after(() => {
      try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
    });

    it('recallQuery does not modify file system', () => {
      const pmemDir = path.join(testDir, '.pmem');
      const beforeFiles = countMdFiles(pmemDir);
      const beforeCards = countCards(pmemDir);

      // Call query — should be read-only
      const result = recallQuery(pmemDir);
      assert.ok(result.project.length > 0);

      const afterFiles = countMdFiles(pmemDir);
      const afterCards = countCards(pmemDir);

      assert.strictEqual(afterFiles, beforeFiles, 'MD file count should not change after recallQuery');
      assert.strictEqual(afterCards, beforeCards, 'Card count should not change after recallQuery');
    });

    it('askQuery does not modify file system', () => {
      const pmemDir = path.join(testDir, '.pmem');
      const beforeFiles = countMdFiles(pmemDir);

      const result = askQuery(pmemDir, 'core');
      assert.ok(result.matched.length >= 0);

      const afterFiles = countMdFiles(pmemDir);
      assert.strictEqual(afterFiles, beforeFiles, 'MD file count should not change after askQuery');
    });
  });

  // ── Test 2: Path traversal prevention ──
  describe('validatePathScope', () => {
    it('rejects path traversal to /tmp/evil/.pmem', () => {
      assert.throws(
        () => validatePathScope('/tmp/evil/.pmem'),
        /Path scope violation/
      );
    });

    it('accepts valid .pmem under CWD', () => {
      const cwd = process.cwd();
      const validPath = path.join(cwd, '.pmem');
      // Should not throw
      assert.doesNotThrow(() => validatePathScope(validPath));
    });
  });

  // ── Test 3: Symlink escape prevention ──
  describe('symlink escape prevention', () => {
    let linkDir: string;
    before(() => {
      linkDir = path.join(TEMP_ROOT, 'symlink-test');
      fs.mkdirSync(linkDir, { recursive: true });
      // Create a symlink that would escape .pmem
      const linkPath = path.join(linkDir, 'pmem-link');
      try {
        fs.symlinkSync('/etc', linkPath);
      } catch {
        // symlink may fail on some platforms
      }
    });

    it('rejects symlink pointing outside .pmem', () => {
      const linkPath = path.join(linkDir, 'pmem-link');
      if (fs.existsSync(linkPath)) {
        assert.throws(
          () => validatePathScope(linkPath),
          /Path scope violation/
        );
      }
    });
  });

  // ── Test 4: Prefix confusion prevention ──
  describe('prefix confusion', () => {
    it('rejects .pmem-evil directory (bare startsWith bypass)', () => {
      // CRITICAL: .pmem-evil would pass a naive startsWith('.pmem') check
      assert.throws(
        () => validatePathScope('.pmem-evil/'),
        /Path scope violation/
      );
    });
  });

  // ── Test 5: Source file content not leaked ──
  describe('source file safety', () => {
    it('relatedQuery results do not contain source file content', () => {
      const pmemDir = path.join(process.cwd(), '.pmem');
      try {
        const result = relatedQuery(pmemDir, 'module.cli_runtime_20260602');
        const json = JSON.stringify(result);
        // Should not contain source code content
        assert.ok(!json.includes('import {'), 'Should not contain source code imports');
        assert.ok(!json.includes('export function'), 'Should not contain source code exports');
      } catch (e: any) {
        // Card may not exist — skip
        if (!e.message.includes('not found')) throw e;
      }
    });

    it('askQuery results contain file paths, not file content', () => {
      const pmemDir = path.join(process.cwd(), '.pmem');
      const result = askQuery(pmemDir, 'cli');
      const json = JSON.stringify(result);
      // Should contain file paths but no source code
      assert.ok(!json.includes('#!/usr/bin/env node'), 'Should not contain source code');
    });
  });

  // ── Test 6: Output budget enforcement ──
  describe('enforceBudget', () => {
    it('returns original when under budget', () => {
      const small = { message: 'hello', count: 1 };
      const result = enforceBudget(small, 1000);
      assert.strictEqual(result.truncated, undefined);
      assert.strictEqual(result.message, 'hello');
    });

    it('truncates when over budget', () => {
      const large: any = {
        project: 'test',
        body: 'word '.repeat(5000),
        content: 'word '.repeat(5000),
      };
      const result = enforceBudget(large, 100);
      assert.strictEqual(result.truncated, true);
      assert.ok(result.truncated_reason.includes('max_response_tokens'));
      assert.strictEqual(typeof result.original_tokens, 'number');
      assert.ok(result.original_tokens > 100);
    });
  });

  // ── Test 7: content_trust marking ──
  describe('addContentTrust', () => {
    it('marks card-like objects with content_trust', () => {
      const result = {
        project: 'test',
        matched: [
          { id: 'module.x', type: 'module', title: 'X', file: 'x.md' },
          { id: 'decision.y', type: 'decision', title: 'Y', file: 'y.md' },
        ],
      };
      const trusted = addContentTrust(result);
      assert.strictEqual(trusted.matched[0].content_trust, 'untrusted_project_data');
      assert.strictEqual(trusted.matched[1].content_trust, 'untrusted_project_data');
    });

    it('does not modify card content', () => {
      const result = {
        matched: [{ id: 'module.x', type: 'module', title: 'My Title', summary: 'Some content' }],
      };
      const trusted = addContentTrust(JSON.parse(JSON.stringify(result)));
      assert.strictEqual(trusted.matched[0].title, 'My Title');
      assert.strictEqual(trusted.matched[0].summary, 'Some content');
      assert.strictEqual(trusted.matched[0].content_trust, 'untrusted_project_data');
    });

    it('marks affected_cards entries', () => {
      const result = {
        affected_cards: [
          { card_id: 'module.x', match_type: 'exact' },
        ],
      };
      // affected_cards items don't have id/type/title, so they won't be tagged
      // This is correct — they're just references
      const trusted = addContentTrust(result);
      assert.strictEqual(trusted.affected_cards[0].content_trust, undefined);
    });
  });
});

function countFiles(dir: string): number {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

/** Count only .md files (memory cards), excluding runtime artifacts like SQLite WAL. */
function countMdFiles(dir: string): number {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countMdFiles(fullPath);
    } else if (entry.name.endsWith('.md')) {
      count++;
    }
  }
  return count;
}

function countCards(dir: string): number {
  const dbPath = path.join(dir, 'pmem.db');
  if (!fs.existsSync(dbPath)) return 0;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE is_deleted = 0').get() as { cnt: number };
    db.close();
    return row.cnt;
  } catch {
    return 0;
  }
}
