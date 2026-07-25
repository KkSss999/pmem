/**
 * v0.7.0 Phase 1: Focused CLI tests for `pmem new` behavior.
 *
 * NOTE: This CLI test runs against the compiled CLI in dist/index.js.
 * It depends on `npm run build` having run. If running tests locally,
 * run `npm run build` first or use `npm test` which automatically triggers
 * the `pretest` build hook.
 *
 * Covers:
 * - Old project (no schema): rejects project/assumption/resource/integration (exit 2)
 * - Old project: accepts module (exit 0, writes to modules/)
 * - Custom schema: accepts character (exit 0, writes to characters/)
 *
 * Uses child_process.execSync to run the real CLI, avoiding process.exit(2)
 * killing the test runner (the error is caught and its status code inspected).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-new-test-${Date.now()}`);

function pmem(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node "${PMEM_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
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

function writeManifest(pmemDir: string, extra: string = '') {
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

describe('pmem new (CLI) — old project (no schema)', () => {
  const cwd = path.join(TEMP_ROOT, 'old-project');

  before(() => {
    fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
    writeManifest(path.join(cwd, '.pmem'));
  });

  after(() => {
    fs.rmSync(path.join(TEMP_ROOT, 'old-project'), { recursive: true, force: true });
  });

  for (const badType of ['project', 'assumption', 'resource', 'integration']) {
    it(`rejects ${badType} (exit 2, old project VALID_TYPES guard)`, () => {
      const r = pmem(`new ${badType} "Test"`, cwd);
      assert.strictEqual(r.code, 2, `expected exit 2 for ${badType}, got ${r.code}`);
      assert.ok(r.stdout.includes(`Invalid card type "${badType}"`), `stdout should mention Invalid card type`);
    });
  }

  it('accepts module (exit 0, writes to modules/)', () => {
    const r = pmem('new module "Core Module"', cwd);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
    assert.ok(r.stdout.includes('Created module card'), `stdout: ${r.stdout}`);
    // File must exist under modules/
    const modulesDir = path.join(cwd, '.pmem', 'modules');
    const files = fs.readdirSync(modulesDir);
    const cardFile = files.find(f => f.startsWith('module.'));
    assert.ok(cardFile, `expected a module.*.md file in modules/, found: ${files.join(', ')}`);
    assert.match(cardFile!, /^module\.core_module_\d{8}\.md$/, 'default ID remains date-stamped');
    const content = fs.readFileSync(path.join(modulesDir, cardFile!), 'utf8');
    assert.ok(content.includes('type: module'), 'frontmatter should contain type: module');
  });
});

describe('pmem new (CLI) — custom schema with character', () => {
  const cwd = path.join(TEMP_ROOT, 'custom-project');

  before(() => {
    fs.mkdirSync(path.join(cwd, '.pmem'), { recursive: true });
    writeManifest(path.join(cwd, '.pmem'), `
schema:
  card_types:
    - character
    - chapter
    - decision
    - trace
    - integration
  type_dirs:
    character: characters
    chapter: chapters
    decision: decisions
    trace: traces
    integration: integrations
`);
  });

  after(() => {
    fs.rmSync(path.join(TEMP_ROOT, 'custom-project'), { recursive: true, force: true });
  });

  it('accepts character (exit 0, writes to characters/)', () => {
    const r = pmem('new character "张三"', cwd);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
    assert.ok(r.stdout.includes('Created character card'), `stdout: ${r.stdout}`);
    const charactersDir = path.join(cwd, '.pmem', 'characters');
    const files = fs.readdirSync(charactersDir);
    const cardFile = files.find(f => f.startsWith('character.'));
    assert.ok(cardFile, `expected a character.*.md file in characters/, found: ${files.join(', ')}`);
    const content = fs.readFileSync(path.join(charactersDir, cardFile!), 'utf8');
    assert.ok(content.includes('type: character'), 'frontmatter should contain type: character');
  });

  it('accepts a meaningful custom ID slug without a date suffix', () => {
    const r = pmem('new character "Lin Xiao" --id protagonist', cwd);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
    const cardPath = path.join(cwd, '.pmem', 'characters', 'character.protagonist.md');
    assert.ok(fs.existsSync(cardPath));
    assert.match(fs.readFileSync(cardPath, 'utf8'), /^id: character\.protagonist$/m);
    assert.match(r.stdout, /ID: character\.protagonist/);
  });

  it('accepts an exact custom ID with the matching type prefix', () => {
    const r = pmem('new character "Mentor" --id character.mentor', cwd);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}`);
    assert.ok(fs.existsSync(path.join(cwd, '.pmem', 'characters', 'character.mentor.md')));
  });

  it('rejects mismatched, unsafe, and uppercase custom IDs without writing cards', () => {
    for (const customId of ['chapter.wrong_type', '../escape', 'Uppercase', '']) {
      const before = fs.readdirSync(path.join(cwd, '.pmem', 'characters')).sort();
      const r = pmem(`new character "Invalid" --id "${customId}"`, cwd);
      assert.strictEqual(r.code, 2, `expected exit 2 for ${customId}, got ${r.code}`);
      assert.deepStrictEqual(fs.readdirSync(path.join(cwd, '.pmem', 'characters')).sort(), before);
    }
  });

  it('does not overwrite an existing custom-ID card', () => {
    const cardPath = path.join(cwd, '.pmem', 'characters', 'character.protagonist.md');
    const before = fs.readFileSync(cardPath, 'utf8');
    const r = pmem('new character "Replacement" --id protagonist', cwd);
    assert.strictEqual(r.code, 2);
    assert.strictEqual(fs.readFileSync(cardPath, 'utf8'), before);
  });

  it('rejects unknown type (exit 2)', () => {
    const r = pmem('new unknown_type "Test"', cwd);
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  });

  it('rejects integration even when in card_types (exit 2)', () => {
    // integration is always excluded from creatable_types
    const r = pmem('new integration "Test"', cwd);
    assert.strictEqual(r.code, 2, `expected exit 2 for integration, got ${r.code}`);
  });
});

// Clean up temp root after all tests
after(() => {
  try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
});
