"use strict";
/**
 * v0.7.0 Phase 1: Focused CLI tests for `pmem new` behavior.
 *
 * Covers:
 * - Old project (no schema): rejects project/assumption/resource/integration (exit 2)
 * - Old project: accepts module (exit 0, writes to modules/)
 * - Custom schema: accepts character (exit 0, writes to characters/)
 *
 * Uses child_process.execSync to run the real CLI, avoiding process.exit(2)
 * killing the test runner (the error is caught and its status code inspected).
 */
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
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-new-test-${Date.now()}`);
function pmem(args, cwd) {
    try {
        const stdout = (0, node_child_process_1.execSync)(`node "${PMEM_BIN}" ${args}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 10_000,
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
function writeManifest(pmemDir, extra = '') {
    const manifestPath = path.join(pmemDir, 'manifest.yml');
    // Minimal v0.6.4 manifest — the same structure `pmem init --guided` produces.
    const yml = `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
project:
  name: test-project
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
${extra}
`;
    fs.writeFileSync(manifestPath, yml, 'utf8');
}
// ── Test suite ────────────────────────────────────────────────
(0, node_test_1.describe)('pmem new (CLI) — old project (no schema)', () => {
    const cwd = path.join(TEMP_ROOT, 'old-project');
    (0, node_test_1.before)(() => {
        fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
        writeManifest(path.join(cwd, '.pmem'));
    });
    (0, node_test_1.after)(() => {
        fs.rmSync(path.join(TEMP_ROOT, 'old-project'), { recursive: true, force: true });
    });
    for (const badType of ['project', 'assumption', 'resource', 'integration']) {
        (0, node_test_1.it)(`rejects ${badType} (exit 2, old project VALID_TYPES guard)`, () => {
            const r = pmem(`new ${badType} "Test"`, cwd);
            node_assert_1.default.strictEqual(r.code, 2, `expected exit 2 for ${badType}, got ${r.code}`);
            node_assert_1.default.ok(r.stdout.includes(`Invalid card type "${badType}"`), `stdout should mention Invalid card type`);
        });
    }
    (0, node_test_1.it)('accepts module (exit 0, writes to modules/)', () => {
        const r = pmem('new module "Core Module"', cwd);
        node_assert_1.default.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
        node_assert_1.default.ok(r.stdout.includes('Created module card'), `stdout: ${r.stdout}`);
        // File must exist under modules/
        const modulesDir = path.join(cwd, '.pmem', 'modules');
        const files = fs.readdirSync(modulesDir);
        const cardFile = files.find(f => f.startsWith('module.'));
        node_assert_1.default.ok(cardFile, `expected a module.*.md file in modules/, found: ${files.join(', ')}`);
        const content = fs.readFileSync(path.join(modulesDir, cardFile), 'utf8');
        node_assert_1.default.ok(content.includes('type: module'), 'frontmatter should contain type: module');
    });
});
(0, node_test_1.describe)('pmem new (CLI) — custom schema with character', () => {
    const cwd = path.join(TEMP_ROOT, 'custom-project');
    (0, node_test_1.before)(() => {
        fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
        writeManifest(path.join(cwd, '.pmem'), `
schema:
  card_types:
    - character
    - chapter
    - decision
    - trace
  type_dirs:
    character: characters
    chapter: chapters
    decision: decisions
    trace: traces
`);
    });
    (0, node_test_1.after)(() => {
        fs.rmSync(path.join(TEMP_ROOT, 'custom-project'), { recursive: true, force: true });
    });
    (0, node_test_1.it)('accepts character (exit 0, writes to characters/)', () => {
        const r = pmem('new character "张三"', cwd);
        node_assert_1.default.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
        node_assert_1.default.ok(r.stdout.includes('Created character card'), `stdout: ${r.stdout}`);
        const charactersDir = path.join(cwd, '.pmem', 'characters');
        const files = fs.readdirSync(charactersDir);
        const cardFile = files.find(f => f.startsWith('character.'));
        node_assert_1.default.ok(cardFile, `expected a character.*.md file in characters/, found: ${files.join(', ')}`);
        const content = fs.readFileSync(path.join(charactersDir, cardFile), 'utf8');
        node_assert_1.default.ok(content.includes('type: character'), 'frontmatter should contain type: character');
    });
    (0, node_test_1.it)('rejects unknown type (exit 2)', () => {
        const r = pmem('new unknown_type "Test"', cwd);
        node_assert_1.default.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
    });
    (0, node_test_1.it)('rejects integration even when in card_types (exit 2)', () => {
        // integration is always excluded from creatable_types
        const r = pmem('new integration "Test"', cwd);
        node_assert_1.default.strictEqual(r.code, 2, `expected exit 2 for integration, got ${r.code}`);
    });
});
// Clean up temp root after all tests
(0, node_test_1.after)(() => {
    try {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
    catch { }
});
//# sourceMappingURL=new.test.js.map