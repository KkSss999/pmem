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
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-sync-test-${Date.now()}`);
function pmem(args, cwd) {
    try {
        const stdout = (0, node_child_process_1.execSync)(`node "${PMEM_BIN}" ${args}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 15_000,
        });
        return { stdout, stderr: '', code: 0 };
    }
    catch (err) {
        return {
            stdout: err.stdout?.toString() ?? '',
            stderr: err.stderr?.toString() ?? '',
            code: err.status ?? 2,
        };
    }
}
function initGit(cwd) {
    (0, node_child_process_1.execSync)('git init', { cwd });
    (0, node_child_process_1.execSync)('git config user.name "Test User"', { cwd });
    (0, node_child_process_1.execSync)('git config user.email "test@example.com"', { cwd });
}
function commitAll(cwd, msg = "initial") {
    try {
        (0, node_child_process_1.execSync)('git add .', { cwd });
        (0, node_child_process_1.execSync)('git commit -m "' + msg + '"', { cwd });
    }
    catch {
        // Ignore if nothing to commit
    }
}
function writeManifest(pmemDir, extra = '') {
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
(0, node_test_1.describe)('pmem sync and verify integration tests', () => {
    const cwd = path.join(TEMP_ROOT, 'sync-project');
    (0, node_test_1.before)(() => {
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
    (0, node_test_1.after)(() => {
        try {
            fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
        }
        catch { }
    });
    (0, node_test_1.it)('pmem sync with no changes should be clean', () => {
        const r = pmem('sync', cwd);
        node_assert_1.default.strictEqual(r.code, 0);
        node_assert_1.default.ok(r.stdout.includes('No changed files detected'));
    });
    (0, node_test_1.it)('pmem sync with changes but no summary auto-marks dirty and prints recommendation', () => {
        // Modify index.ts
        fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), 'console.log("hello 2");', 'utf8');
        const r = pmem('sync', cwd);
        node_assert_1.default.strictEqual(r.code, 0);
        node_assert_1.default.ok(r.stdout.includes('Auto-marked 1 card(s) as dirty'));
        node_assert_1.default.ok(r.stdout.includes('Recommended: run `pmem sync -s "<summary>" -n "<next>"`'));
        // Manifest memory_status.dirty should be true
        const manifest = fs.readFileSync(path.join(cwd, '.pmem', 'manifest.yml'), 'utf8');
        node_assert_1.default.ok(manifest.includes('dirty: true'));
        // .dirty file should exist
        node_assert_1.default.ok(fs.existsSync(path.join(cwd, '.pmem', '.dirty')));
    });
    (0, node_test_1.it)('pmem sync with changes and summary auto-confirms and updates indexes', () => {
        const r = pmem('sync -s "modified index.ts to log hello 2" -n "implement next feature"', cwd);
        node_assert_1.default.strictEqual(r.code, 0);
        node_assert_1.default.ok(r.stdout.includes('Memory sync and update completed'));
        // Manifest dirty should be false
        const manifest = fs.readFileSync(path.join(cwd, '.pmem', 'manifest.yml'), 'utf8');
        node_assert_1.default.ok(manifest.includes('dirty: false'));
        // .dirty file should be cleaned up
        node_assert_1.default.ok(!fs.existsSync(path.join(cwd, '.pmem', '.dirty')));
        // Trace file should be created
        const tracesDir = path.join(cwd, '.pmem', 'traces');
        const traces = fs.readdirSync(tracesDir);
        node_assert_1.default.strictEqual(traces.length, 1);
        node_assert_1.default.ok(traces[0].endsWith('.md'));
        // next.md should be updated
        const nextContent = fs.readFileSync(path.join(cwd, '.pmem', 'next.md'), 'utf8');
        node_assert_1.default.ok(nextContent.includes('implement next feature'));
    });
    (0, node_test_1.it)('pmem verify --fix-stale (or --fix) updates last_verified timestamp', () => {
        // 1. Re-commit so repo status is clean but make mtime of src/index.ts newer than the card's updated time.
        // Let's modify updated time of card inside SQLite or just backdate card in markdown and rebuild.
        // Currently the card's updated is 2026-06-01T00:00:00.000Z.
        // The mtime of src/index.ts is current time (newer).
        // So the card is stale!
        // Running verify should fail / show stale warning
        const rVerify = pmem('verify', cwd);
        node_assert_1.default.ok(rVerify.stdout.includes('stale_memory'));
        // Run verify --fix-stale
        const rFix = pmem('verify --fix-stale', cwd);
        node_assert_1.default.strictEqual(rFix.code, 0);
        node_assert_1.default.ok(rFix.stdout.includes('Updated last_verified timestamp for card: module.core'));
        const rVerify2 = pmem('verify', cwd);
        node_assert_1.default.ok(rVerify2.stdout.includes('Score: 100/100') || rVerify2.stdout.includes('Memory verification passed'));
    });
    (0, node_test_1.it)('pmem verify relaxed token count warning policy', () => {
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
        node_assert_1.default.ok(rVerify.stdout.includes('card_too_large'));
        node_assert_1.default.ok(rVerify.stdout.includes('Score: 95/100'));
        // Running verify --relaxed should bypass/relax it to info note and score should be 100/100
        const rRelaxed = pmem('verify --relaxed', cwd);
        node_assert_1.default.ok(rRelaxed.stdout.includes('card_too_large_relaxed'));
        node_assert_1.default.ok(rRelaxed.stdout.includes('Score: 100/100'));
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
        node_assert_1.default.ok(rVerifyLocal.stdout.includes('card_too_large_relaxed'));
        node_assert_1.default.ok(rVerifyLocal.stdout.includes('Score: 100/100'));
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
        node_assert_1.default.ok(rVerifyManifest.stdout.includes('card_too_large_relaxed'));
        node_assert_1.default.ok(rVerifyManifest.stdout.includes('Score: 100/100'));
    });
});
//# sourceMappingURL=sync_verify.test.js.map