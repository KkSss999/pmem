/**
 * v0.7.6 fix U8: pmem status --format json must surface new and modified
 * markdown files under .pmem as affected_cards entries (with reason
 * new_card / modified_card) AND signal needs_rebuild: true so agents know
 * the SQLite paths table is stale.
 *
 * Before this fix, status only consulted the SQLite paths table — which
 * is only populated by pmem rebuild. Result: new cards were invisible in
 * affected_cards[] until the user manually ran pmem rebuild.
 *
 * These tests run the real CLI via child_process so they exercise the full
 * command path (git/mtime detection → frontmatter parsing → JSON output).
 * Each test creates an isolated temp project, so they're CI-safe.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-status-u8-test-${Date.now()}-${process.pid}`);

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

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeManifest(): string {
  return `pmem:
  schema_version: '0.3'
  protocol_version: '0.3'
  created_by: 0.3.0
  last_migrated_by: null
schema:
  card_types: [module, feature, task, decision, trace, risk]
  default_type: module
  foundational_types: [module]
  evidence_types: [decision, trace]
  creatable_types: [module, feature, task, decision, trace, risk]
  type_dirs:
    module: modules
    feature: features
    task: tasks
    decision: decisions
    trace: traces
    risk: risks
project:
  name: status-u8-test
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
    - .pmem/features/**/*.md
    - .pmem/decisions/**/*.md
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
    enabled: false
    path: .pmem/.lock
    timeout: 3s
    stale_after: 60s
    on_timeout: abort
  optimistic_lock:
    enabled: false
    note: ''
cli:
  default_format: compact
  supported_formats: [compact, json, paths, pack]
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
  enabled: false
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
card_policy:
  id_pattern: '^(module|task|feature|decision|trace|risk)\\.[a-z0-9._-]+$'
  max_tokens:
    module: 1000
    task: 800
  max_sections:
    module: 8
    task: 6
  warn_when_related_count_gt: 12
distill:
  enabled: false
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
}

function cardFile(id: string, type: string): string {
  return `---
id: ${id}
type: ${type}
status: active
---
# ${id}

This card has id ${id} and type ${type}.
`;
}

// ── Test suite ────────────────────────────────────────────────

describe('pmem status --format json (v0.7.6 U8: memory-change detection)', () => {
  const cwd = path.join(TEMP_ROOT, 'status-u8');

  before(() => {
    fs.mkdirSync(cwd, { recursive: true });
    const pmemDir = path.join(cwd, '.pmem');
    fs.mkdirSync(pmemDir, { recursive: true });
    writeFile(path.join(pmemDir, 'manifest.yml'), makeManifest());
    // Make sure we have a modules/ dir so that newly added .md files are not
    // filtered as out-of-tree by any future logic.
    fs.mkdirSync(path.join(pmemDir, 'modules'), { recursive: true });

    // Initialize git so the status command uses git-mode (gives us explicit
    // A / M status hints, which lets the U8 logic distinguish new vs
    // modified without requiring a pre-seeded SQLite paths table).
    execSync('git init -q', { cwd });
    execSync('git config user.email "test@example.com"', { cwd });
    execSync('git config user.name "Test User"', { cwd });
    execSync('git add -A', { cwd });
    execSync('git commit -q -m "initial empty"', { cwd });
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reports a new .pmem/**/*.md file as affected_card (reason=new_card) and sets needs_rebuild=true', () => {
    // Create a brand-new card file under .pmem/modules/ — git will report
    // it as '??' (untracked), which the U8 logic translates to new_card.
    const newCardPath = path.join(cwd, '.pmem', 'modules', 'module.foo.md');
    writeFile(newCardPath, cardFile('module.foo', 'module'));

    const r = pmem('status --format json', cwd);
    assert.strictEqual(r.code, 0, `status should exit 0, got: ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.needs_rebuild, true, 'needs_rebuild should be true when a new memory file is detected');
    assert.strictEqual(out.state, 'memory_changes_detected', 'state should reflect memory changes');

    // Find the affected card for module.foo
    const fooCard = (out.affected_cards as Array<{ id: string; reason: string }>)
      .find((c) => c.id === 'module.foo');
    assert.ok(fooCard, `affected_cards should contain module.foo, got: ${JSON.stringify(out.affected_cards)}`);
    assert.strictEqual(fooCard!.reason, 'new_card', `reason should be new_card, got: ${fooCard!.reason}`);

    // And the change entry must also reference this card
    const newChange = (out.changes as Array<{ path: string; related_cards: Array<{ card_id: string }> }>)
      .find((c) => c.path === '.pmem/modules/module.foo.md');
    assert.ok(newChange, `changes[] should contain .pmem/modules/module.foo.md`);
    assert.ok(
      newChange!.related_cards.some((rc) => rc.card_id === 'module.foo'),
      `change.related_cards should include module.foo, got: ${JSON.stringify(newChange!.related_cards)}`
    );
  });

  it('reports a modified .pmem/**/*.md file as affected_card (reason=modified_card) and sets needs_rebuild=true', () => {
    // Commit an existing card first so git tracks it.
    const cardPath = path.join(cwd, '.pmem', 'modules', 'module.bar.md');
    writeFile(cardPath, cardFile('module.bar', 'module'));
    execSync('git add -A', { cwd });
    execSync('git commit -q -m "add module.bar"', { cwd });

    // Now modify the file — git will report 'M'.
    fs.writeFileSync(cardPath, cardFile('module.bar', 'module') + '\n<!-- edited -->\n');

    const r = pmem('status --format json', cwd);
    assert.strictEqual(r.code, 0, `status should exit 0, got: ${r.code}\nstdout: ${r.stdout}`);

    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.needs_rebuild, true, 'needs_rebuild should be true when an existing memory file is modified');

    const barCard = (out.affected_cards as Array<{ id: string; reason: string }>)
      .find((c) => c.id === 'module.bar');
    assert.ok(barCard, `affected_cards should contain module.bar, got: ${JSON.stringify(out.affected_cards)}`);
    assert.strictEqual(barCard!.reason, 'modified_card', `reason should be modified_card, got: ${barCard!.reason}`);
  });

  it('reports needs_rebuild=false when there are no memory changes', () => {
    // Remove any previously created memory files and commit the cleanup so
    // git's working tree is clean w.r.t. .pmem/modules/*.md.
    for (const f of fs.readdirSync(path.join(cwd, '.pmem', 'modules'))) {
      if (f.endsWith('.md')) fs.unlinkSync(path.join(cwd, '.pmem', 'modules', f));
    }
    execSync('git add -A', { cwd });
    execSync('git commit -q -m "remove memory files"', { cwd });

    // Now edit a non-memory source file. Source changes alone should NOT
    // trigger needs_rebuild.
    const srcDir = path.join(cwd, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, 'index.ts');
    writeFile(srcFile, '// sample\n');

    const r = pmem('status --format json', cwd);
    assert.strictEqual(r.code, 0, `status should exit 0, got: ${r.code}\nstdout: ${r.stdout}`);

    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.needs_rebuild, false, 'needs_rebuild should be false when no memory files are new/modified');
    assert.strictEqual(out.state, 'source_changes_only', 'nonempty unrelated source changes should not be reported as no_changes');
    assert.strictEqual(out.suggested_action, 'review source changes; no related memory cards found');

    // And no card should be marked as new_card or modified_card.
    const memChanges = (out.affected_cards as Array<{ reason: string }>)
      .filter((c) => c.reason === 'new_card' || c.reason === 'modified_card');
    assert.strictEqual(memChanges.length, 0,
      `no card should have reason new_card/modified_card, got: ${JSON.stringify(memChanges)}`);
  });
});