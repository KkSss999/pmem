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
const context_1 = require("../core/query/context");
const capture_1 = require("../core/capture");
const security_1 = require("./security");
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-capture-test-${Date.now()}`);
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
(0, node_test_1.describe)('pmem context & capture functionality', () => {
    let testDir;
    let pmemDir;
    let oldCwd;
    (0, node_test_1.before)(() => {
        testDir = path.join(TEMP_ROOT, 'capture-workspace');
        pmemDir = path.join(testDir, '.pmem');
        fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });
        const { execSync } = require('child_process');
        try {
            execSync('git init -q', { cwd: testDir });
            execSync('git config user.email "test@example.com"', { cwd: testDir });
            execSync('git config user.name "test"', { cwd: testDir });
        }
        catch { }
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
        }
        catch { /* ignore */ }
        // Commit baseline
        try {
            execSync('git add .', { cwd: testDir });
            execSync('git commit -q -m "baseline"', { cwd: testDir });
        }
        catch { }
        oldCwd = process.cwd();
        process.chdir(testDir);
    });
    (0, node_test_1.after)(() => {
        if (oldCwd) {
            process.chdir(oldCwd);
        }
        try {
            fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
        }
        catch { }
    });
    (0, node_test_1.describe)('validateCaptureInputs', () => {
        (0, node_test_1.it)('rejects summary longer than 2000 characters', () => {
            const longSummary = 'A'.repeat(2001);
            node_assert_1.default.throws(() => (0, security_1.validateCaptureInputs)('.pmem', longSummary, 'next'), /Security: summary input exceeds max size/);
        });
        (0, node_test_1.it)('rejects next longer than 2000 characters', () => {
            const longNext = 'B'.repeat(2001);
            node_assert_1.default.throws(() => (0, security_1.validateCaptureInputs)('.pmem', 'summary', longNext), /Security: next input exceeds max size/);
        });
        (0, node_test_1.it)('rejects control characters in summary', () => {
            const maliciousSummary = 'Summary\x00withNull';
            node_assert_1.default.throws(() => (0, security_1.validateCaptureInputs)('.pmem', maliciousSummary, 'next'), /Security: summary input contains invalid control characters/);
        });
        (0, node_test_1.it)('rejects reserved comment markers to prevent injection', () => {
            node_assert_1.default.throws(() => (0, security_1.validateCaptureInputs)('.pmem', '<!-- pmem:next:start --> summary', 'next'), /Security: capture input contains reserved pmem marker/);
            node_assert_1.default.throws(() => (0, security_1.validateCaptureInputs)('.pmem', 'summary', '<!-- pmem:rules:end --> next'), /Security: capture input contains reserved pmem marker/);
        });
        (0, node_test_1.it)('accepts valid inputs', () => {
            node_assert_1.default.doesNotThrow(() => (0, security_1.validateCaptureInputs)('.pmem', 'Valid Summary', 'Valid Next Step'));
        });
    });
    (0, node_test_1.describe)('contextQuery', () => {
        (0, node_test_1.it)('aggregates context and finds relevant files', () => {
            const result = (0, context_1.contextQuery)('.pmem', 'core module');
            node_assert_1.default.strictEqual(result.task, 'core module');
            node_assert_1.default.strictEqual(result.project_stage, 'Development');
            node_assert_1.default.strictEqual(result.current_focus, 'Testing capture logic');
            const paths = result.must_read.map(m => m.path);
            node_assert_1.default.ok(paths.includes('.pmem/state.md'));
            node_assert_1.default.ok(paths.includes('.pmem/next.md'));
        });
    });
    (0, node_test_1.describe)('captureCore', () => {
        (0, node_test_1.it)('skips writing trace if no files changed', () => {
            const result = (0, capture_1.captureCore)('.pmem', { summary: 'No changes', next: 'Step' });
            node_assert_1.default.ok(result.success);
            node_assert_1.default.strictEqual(result.skipped, true);
        });
        (0, node_test_1.it)('writes trace and updates next.md inside managed block when force=true', () => {
            const result = (0, capture_1.captureCore)('.pmem', {
                summary: 'Force sync capture',
                next: 'Write test assertions',
                force: true
            });
            node_assert_1.default.ok(result.success);
            node_assert_1.default.ok(result.tracePath);
            node_assert_1.default.ok(fs.existsSync(result.tracePath));
            const nextContent = fs.readFileSync('.pmem/next.md', 'utf8');
            node_assert_1.default.ok(nextContent.includes('<!-- pmem:next:start -->'));
            node_assert_1.default.ok(nextContent.includes('- Recommended next step: Write test assertions'));
            node_assert_1.default.ok(nextContent.includes('<!-- pmem:next:end -->'));
            const traceContent = fs.readFileSync(result.tracePath, 'utf8');
            node_assert_1.default.ok(traceContent.includes('diff_hash:'));
            node_assert_1.default.ok(traceContent.includes('# Capture: Force sync capture'));
            const secondResult = (0, capture_1.captureCore)('.pmem', {
                summary: 'Force sync capture',
                next: 'Write test assertions',
                force: false
            });
            node_assert_1.default.ok(secondResult.success);
            node_assert_1.default.strictEqual(secondResult.skipped, true, 'Should skip duplicate diff_hash trace writing');
        });
        (0, node_test_1.it)('sanitizes summary name to prevent path traversal in trace creation', () => {
            const result = (0, capture_1.captureCore)('.pmem', {
                summary: '../../evil.md',
                next: 'Traversing',
                force: true
            });
            node_assert_1.default.ok(result.success);
            node_assert_1.default.ok(result.tracePath);
            const filename = path.basename(result.tracePath);
            node_assert_1.default.ok(!filename.includes('evil'));
            node_assert_1.default.ok(result.tracePath.startsWith(path.resolve('.pmem', 'traces')));
        });
        (0, node_test_1.it)('pmem_capture with malicious summary cannot affect trace filename or write path', () => {
            const result = (0, capture_1.captureCore)('.pmem', {
                summary: '../../module.core.md',
                next: 'Attack summary',
                force: true
            });
            node_assert_1.default.ok(result.success);
            node_assert_1.default.ok(result.tracePath);
            const filename = path.basename(result.tracePath);
            node_assert_1.default.ok(!filename.includes('module.core.md'));
            node_assert_1.default.ok(result.tracePath.startsWith(path.resolve('.pmem', 'traces')));
            node_assert_1.default.match(filename, /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}\.md$/);
        });
    });
});
//# sourceMappingURL=capture.test.js.map