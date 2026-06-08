"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
// Import the functions under test directly
const security_1 = require("./security");
const recall_1 = require("../core/query/recall");
const ask_1 = require("../core/query/ask");
const related_1 = require("../core/query/related");
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-mcp-test-${Date.now()}`);
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
(0, node_test_1.describe)('MCP security module', () => {
    // ── Test 1: Read-only verification ──
    (0, node_test_1.describe)('read-only tools', () => {
        let testDir;
        (0, node_test_1.before)(() => {
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
            }
            catch { /* ignore */ }
        });
        (0, node_test_1.after)(() => {
            try {
                fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
            }
            catch { }
        });
        (0, node_test_1.it)('recallQuery does not modify file system', () => {
            const pmemDir = path.join(testDir, '.pmem');
            const beforeFiles = countMdFiles(pmemDir);
            const beforeCards = countCards(pmemDir);
            // Call query — should be read-only
            const result = (0, recall_1.recallQuery)(pmemDir);
            node_assert_1.default.ok(result.project.length > 0);
            const afterFiles = countMdFiles(pmemDir);
            const afterCards = countCards(pmemDir);
            node_assert_1.default.strictEqual(afterFiles, beforeFiles, 'MD file count should not change after recallQuery');
            node_assert_1.default.strictEqual(afterCards, beforeCards, 'Card count should not change after recallQuery');
        });
        (0, node_test_1.it)('askQuery does not modify file system', () => {
            const pmemDir = path.join(testDir, '.pmem');
            const beforeFiles = countMdFiles(pmemDir);
            const result = (0, ask_1.askQuery)(pmemDir, 'core');
            node_assert_1.default.ok(result.matched.length >= 0);
            const afterFiles = countMdFiles(pmemDir);
            node_assert_1.default.strictEqual(afterFiles, beforeFiles, 'MD file count should not change after askQuery');
        });
    });
    // ── Test 2: Path traversal prevention ──
    (0, node_test_1.describe)('validatePathScope', () => {
        (0, node_test_1.it)('rejects path traversal to /tmp/evil/.pmem', () => {
            node_assert_1.default.throws(() => (0, security_1.validatePathScope)('/tmp/evil/.pmem'), /Path scope violation/);
        });
        (0, node_test_1.it)('accepts valid .pmem under CWD', () => {
            const cwd = process.cwd();
            const validPath = path.join(cwd, '.pmem');
            // Should not throw
            node_assert_1.default.doesNotThrow(() => (0, security_1.validatePathScope)(validPath));
        });
    });
    // ── Test 3: Symlink escape prevention ──
    (0, node_test_1.describe)('symlink escape prevention', () => {
        let linkDir;
        (0, node_test_1.before)(() => {
            linkDir = path.join(TEMP_ROOT, 'symlink-test');
            fs.mkdirSync(linkDir, { recursive: true });
            // Create a symlink that would escape .pmem
            const linkPath = path.join(linkDir, 'pmem-link');
            try {
                fs.symlinkSync('/etc', linkPath);
            }
            catch {
                // symlink may fail on some platforms
            }
        });
        (0, node_test_1.it)('rejects symlink pointing outside .pmem', () => {
            const linkPath = path.join(linkDir, 'pmem-link');
            if (fs.existsSync(linkPath)) {
                node_assert_1.default.throws(() => (0, security_1.validatePathScope)(linkPath), /Path scope violation/);
            }
        });
    });
    // ── Test 4: Prefix confusion prevention ──
    (0, node_test_1.describe)('prefix confusion', () => {
        (0, node_test_1.it)('rejects .pmem-evil directory (bare startsWith bypass)', () => {
            // CRITICAL: .pmem-evil would pass a naive startsWith('.pmem') check
            node_assert_1.default.throws(() => (0, security_1.validatePathScope)('.pmem-evil/'), /Path scope violation/);
        });
    });
    // ── Test 5: Source file content not leaked ──
    (0, node_test_1.describe)('source file safety', () => {
        (0, node_test_1.it)('relatedQuery results do not contain source file content', () => {
            const pmemDir = path.join(process.cwd(), '.pmem');
            try {
                const result = (0, related_1.relatedQuery)(pmemDir, 'module.cli_runtime_20260602');
                const json = JSON.stringify(result);
                // Should not contain source code content
                node_assert_1.default.ok(!json.includes('import {'), 'Should not contain source code imports');
                node_assert_1.default.ok(!json.includes('export function'), 'Should not contain source code exports');
            }
            catch (e) {
                // Card may not exist — skip
                if (!e.message.includes('not found'))
                    throw e;
            }
        });
        (0, node_test_1.it)('askQuery results contain file paths, not file content', () => {
            const pmemDir = path.join(process.cwd(), '.pmem');
            const result = (0, ask_1.askQuery)(pmemDir, 'cli');
            const json = JSON.stringify(result);
            // Should contain file paths but no source code
            node_assert_1.default.ok(!json.includes('#!/usr/bin/env node'), 'Should not contain source code');
        });
    });
    // ── Test 6: Output budget enforcement ──
    (0, node_test_1.describe)('enforceBudget', () => {
        (0, node_test_1.it)('returns original when under budget', () => {
            const small = { message: 'hello', count: 1 };
            const result = (0, security_1.enforceBudget)(small, 1000);
            node_assert_1.default.strictEqual(result.truncated, undefined);
            node_assert_1.default.strictEqual(result.message, 'hello');
        });
        (0, node_test_1.it)('truncates when over budget', () => {
            const large = {
                project: 'test',
                body: 'word '.repeat(5000),
                content: 'word '.repeat(5000),
            };
            const result = (0, security_1.enforceBudget)(large, 100);
            node_assert_1.default.strictEqual(result.truncated, true);
            node_assert_1.default.ok(result.truncated_reason.includes('max_response_tokens'));
            node_assert_1.default.strictEqual(typeof result.original_tokens, 'number');
            node_assert_1.default.ok(result.original_tokens > 100);
        });
    });
    // ── Test 7: content_trust marking ──
    (0, node_test_1.describe)('addContentTrust', () => {
        (0, node_test_1.it)('marks card-like objects with content_trust', () => {
            const result = {
                project: 'test',
                matched: [
                    { id: 'module.x', type: 'module', title: 'X', file: 'x.md' },
                    { id: 'decision.y', type: 'decision', title: 'Y', file: 'y.md' },
                ],
            };
            const trusted = (0, security_1.addContentTrust)(result);
            node_assert_1.default.strictEqual(trusted.matched[0].content_trust, 'untrusted_project_data');
            node_assert_1.default.strictEqual(trusted.matched[1].content_trust, 'untrusted_project_data');
        });
        (0, node_test_1.it)('does not modify card content', () => {
            const result = {
                matched: [{ id: 'module.x', type: 'module', title: 'My Title', summary: 'Some content' }],
            };
            const trusted = (0, security_1.addContentTrust)(JSON.parse(JSON.stringify(result)));
            node_assert_1.default.strictEqual(trusted.matched[0].title, 'My Title');
            node_assert_1.default.strictEqual(trusted.matched[0].summary, 'Some content');
            node_assert_1.default.strictEqual(trusted.matched[0].content_trust, 'untrusted_project_data');
        });
        (0, node_test_1.it)('marks affected_cards entries', () => {
            const result = {
                affected_cards: [
                    { card_id: 'module.x', match_type: 'exact' },
                ],
            };
            // affected_cards items don't have id/type/title, so they won't be tagged
            // This is correct — they're just references
            const trusted = (0, security_1.addContentTrust)(result);
            node_assert_1.default.strictEqual(trusted.affected_cards[0].content_trust, undefined);
        });
    });
});
function countFiles(dir) {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            count += countFiles(path.join(dir, entry.name));
        }
        else {
            count++;
        }
    }
    return count;
}
/** Count only .md files (memory cards), excluding runtime artifacts like SQLite WAL. */
function countMdFiles(dir) {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countMdFiles(fullPath);
        }
        else if (entry.name.endsWith('.md')) {
            count++;
        }
    }
    return count;
}
function countCards(dir) {
    const dbPath = path.join(dir, 'pmem.db');
    if (!fs.existsSync(dbPath))
        return 0;
    try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        const row = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE is_deleted = 0').get();
        db.close();
        return row.cnt;
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=security.test.js.map