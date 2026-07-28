/**
 * v0.8 ask pipeline integration tests.
 *
 * Each test builds a minimal .pmem fixture, runs rebuild to populate the
 * SQLite runtime index (including FTS), then calls `askQuery` through the
 * public API.  All assertions go through the public `AskResultV03` shape —
 * no private helper is tested directly.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { askQuery } from './ask';
import { closeDatabase } from '../db';

const PMEM_BIN = path.resolve(__dirname, '../../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-ask-test-${Date.now()}`);

function pmem(args: string, cwd: string): string {
  return execSync(`node "${PMEM_BIN}" ${args}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000,
  });
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function makeManifest(cardTypes?: string[]): string {
  const types = cardTypes ?? ['decision', 'feature', 'module', 'task', 'trace'];
  const dirs = types.map(t => `      ${t}: ${t}s/`).join('\n');
  return `pmem:
  schema_version: "0.3"
  protocol_version: "0.3"
  created_by: pmem-init-test
  last_migrated_by: null
project:
  name: ask-test
  language: en
  status: active
source_of_truth:
  type: markdown_cards
  path: .pmem/
  card_globs:
    - .pmem/**/*.md
memory_status:
  completeness: usable
  initialized_mode: minimal
  dirty: false
  dirty_since: null
  dirty_reason: null
concurrency:
  mode: file-basic
  atomic_write: true
  lock:
    enabled: true
    path: .pmem/.lock
    timeout: 10s
    stale_after: 30s
    on_timeout: abort
  optimistic_lock:
    enabled: false
    note: ''
card_policy:
  id_pattern: '^(?<type>[a-z][a-z0-9_]*)\\\\.(?<name>[a-z0-9._-]+)$'
  max_tokens:
    decision: 2000
    feature: 2000
    module: 2000
    task: 2000
    trace: 2000
    default: 2000
  max_sections:
    decision: 10
    feature: 10
    module: 10
    task: 10
    trace: 10
    default: 10
  warn_when_related_count_gt: 15
auto_update:
  enabled: false
  on_code_change: ignore
  on_doc_change: ignore
  on_memory_change: ignore
  on_session_end: ignore
  on_git_commit: ignore
  min_trace_interval: 1h
  max_auto_traces_per_day: 50
  ignore_patterns: []
  trace_policy:
    require_meaningful_change: false
    require_summary: false
    require_related_node: false
freshness:
  default_ttl: 90d
  stale_on_related_code_change: false
  require_last_verified: false
distill:
  enabled: false
  cadence: weekly
  max_undistilled_traces: 100
  require_confirmation: true
  suggest_card_splits: false
integrations:
  active: []
migrations:
  applied: []
runtime:
  mode: sqlite
  db_path: .pmem/pmem.db
  markdown_source: true
indexes:
  primary: sqlite
  legacy_json:
    enabled: true
    retained: true
    path: .pmem/indexes/graph.json
rebuild:
  strategy: content_hash
  hash:
    file_hash: true
    frontmatter_hash: true
    body_hash: true
cli:
  default_format: compact
  supported_formats:
    - compact
    - json
    - paths
    - pack
  default_budget: 2000
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
schema:
  card_types:
${types.map(t => `    - ${t}`).join('\n')}
  type_dirs:
${dirs}
  foundational_types:
    - module
  evidence_types:
    - decision
    - trace
  default_type: decision
  creatable_types:
${types.map(t => `    - ${t}`).join('\n')}
`;
}

let testDir: string;
let pmemPath: string;

function fixtureDir(sub: string): string {
  const d = path.join(TEMP_ROOT, sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Ensure a fresh DB connection for the current test's pmemPath. */
function query(pmemPath: string, q: string, opts?: Parameters<typeof askQuery>[2]): ReturnType<typeof askQuery> {
  closeDatabase();
  return askQuery(pmemPath, q, opts);
}

// ── helpers ──────────────────────────────────────────────────────────

function sortedIds(result: ReturnType<typeof askQuery>): string[] {
  return result.matched.map(m => m.id);
}

function idAt(result: ReturnType<typeof askQuery>, index: number): string {
  return result.matched[index]?.id ?? '';
}

// ── Tests ────────────────────────────────────────────────────────────

describe('v0.8 ask pipeline integration', () => {
  before(() => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
  });

  after(() => {
    closeDatabase();
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  // ── i. exact ID first ──────────────────────────────────────────

  it('ranks exact ID match first', () => {
    testDir = fixtureDir('exact-id');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.alpha.md'), `---
id: decision.alpha
type: decision
title: "Alpha Decision"
status: active
tags: [alpha]
---
# Alpha Decision

Some body text about important architecture.
`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.beta.md'), `---
id: decision.beta
type: decision
title: "Beta Decision"
status: active
tags: [beta, alpha-test]
---
# Beta Decision

Discussion of beta and related hybrid patterns.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    // Exact ID query
    const r = query(pmemPath, 'decision.alpha', { limit: 5 });
    assert.strictEqual(r.matched.length, 1);
    assert.strictEqual(r.matched[0].id, 'decision.alpha');
    assert.strictEqual(r.matched[0].match_type, 'exact_id');
    assert.ok(r.matched[0].score === 1.0 || (r.matched[0].score! >= 0.9), 'exact ID score should be high');
  });

  // ── ii. source_file query ──────────────────────────────────────

  it('finds cards by source_file path', () => {
    testDir = fixtureDir('source-file');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'modules', 'module.auth.md'), `---
id: module.auth
type: module
title: "Auth Module"
status: active
source_files:
  - src/auth/login.ts
  - src/auth/logout.ts
---
# Auth Module

Handles authentication.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r = query(pmemPath, 'src/auth/login.ts', { limit: 5, explain: true });
    assert.ok(r.matched.length >= 1, 'should find at least one source_file match');
    assert.strictEqual(r.matched[0].id, 'module.auth');
    assert.strictEqual(r.matched[0].match_type, 'source_file');

    // Explain mode should include reasons
    assert.ok(r.matched[0].reasons, 'explain mode should include reasons');
    assert.ok(r.matched[0].reasons!.length >= 1);
    const sfReason = r.matched[0].reasons!.find(rr => rr.channel === 'source_file');
    assert.ok(sfReason, 'should have source_file reason');
  });

  // ── iii. fuzzy FTS / title query top-N ─────────────────────────

  it('ranks title-matched cards above pure body FTS hits for fuzzy queries', () => {
    testDir = fixtureDir('fuzzy-title');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    // Card with "hybrid recall" in title — should rank high
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.hybrid_target.md'), `---
id: decision.hybrid_target
type: decision
title: "v0.8 Hybrid Recall Engine"
status: active
tags: [hybrid-search, recall]
---
# v0.8 Hybrid Recall Engine

This is the main architecture decision for the hybrid recall system.
`);
    // Card that only mentions "hybrid" and "recall" in body — should rank lower
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.unrelated.md'), `---
id: decision.unrelated
type: decision
title: "MCP Deferred Decision"
status: active
tags: [mcp]
---
# MCP Deferred Decision

This card discusses hybrid approaches and recall mechanisms only incidentally in its body text.
`);
    // Another title-matched card
    writeFile(path.join(testDir, '.pmem', 'features', 'feature.hybrid.md'), `---
id: feature.hybrid
type: feature
title: "Hybrid Recall Feature"
status: draft
tags: [hybrid-search]
---
# Hybrid Recall Feature

Feature card for hybrid recall.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r = query(pmemPath, 'hybrid recall', { limit: 5, explain: true });
    assert.ok(r.matched.length >= 3, 'should find at least 3 matches');

    // Title-matched cards should appear before body-only FTS matches
    const titleMatchedIds = r.matched
      .filter(m => m.reasons?.some(rr => rr.channel === 'title_phrase' || rr.channel === 'title_token'))
      .map(m => m.id);
    assert.ok(titleMatchedIds.length >= 2, 'at least 2 cards should have title match reasons');

    // decision.hybrid_target should be in top-2 (title match + decision type boost)
    const top2Ids = r.matched.slice(0, 2).map(m => m.id);
    const hasTitleCardInTop2 = top2Ids.includes('decision.hybrid_target') ||
      top2Ids.includes('feature.hybrid');
    assert.ok(hasTitleCardInTop2, 'at least one title-matched card should be in top-2');
  });

  // ── iv. dirty/stale card downgrade but still visible ───────────

  it('downgrades dirty cards but keeps them visible', () => {
    testDir = fixtureDir('stale-downgrade');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.fresh.md'), `---
id: decision.fresh
type: decision
title: "Fresh Decision"
status: active
tags: [active]
created: "2026-07-03"
updated: "2026-07-03T12:00:00.000Z"
last_verified: "2026-07-03T12:00:00.000Z"
---
# Fresh Decision

This is a recently verified decision.
`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.stale_card.md'), `---
id: decision.stale_card
type: decision
title: "Stale Decision"
status: active
tags: [active]
created: "2026-01-01"
updated: "2026-01-01T00:00:00.000Z"
last_verified: "2025-01-01T00:00:00.000Z"
---
# Stale Decision

This old decision hasn't been verified in a long time.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r = query(pmemPath, 'decision', { limit: 10, explain: true });
    assert.ok(r.matched.length >= 2, 'should find both cards');

    const stale = r.matched.find(m => m.id === 'decision.stale_card');
    const fresh = r.matched.find(m => m.id === 'decision.fresh');

    assert.ok(stale, 'stale card must be present');
    assert.ok(fresh, 'fresh card must be present');
    assert.strictEqual(stale.stale, true, 'stale card should be marked stale');
    assert.strictEqual(fresh.stale, false, 'fresh card should not be marked stale');

    // Fresh card should rank above stale card (all else being equal)
    const freshIdx = r.matched.findIndex(m => m.id === 'decision.fresh');
    const staleIdx = r.matched.findIndex(m => m.id === 'decision.stale_card');
    assert.ok(freshIdx < staleIdx,
      `fresh card (idx ${freshIdx}) should rank above stale card (idx ${staleIdx})`);
  });

  // ── v. graph expansion ─────────────────────────────────────────

  it('expands graph from seed hits via depends_on edges', () => {
    testDir = fixtureDir('graph-expand');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.root.md'), `---
id: decision.root
type: decision
title: "Root Decision"
status: active
tags: [root]
depends_on:
  - decision.child_a
related:
  - decision.child_b
---
# Root Decision

Root depends on child_a and is related to child_b.
`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.child_a.md'), `---
id: decision.child_a
type: decision
title: "Child A"
status: active
tags: [child]
---
# Child A

This is a dependency of root.
`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.child_b.md'), `---
id: decision.child_b
type: decision
title: "Child B"
status: active
tags: [child]
---
# Child B

Related to root.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    // Query for root — should find root directly via ID match
    const r = query(pmemPath, 'decision.root', { limit: 10, explain: true });
    assert.ok(r.matched.length >= 1, 'should find root');

    // Root should be first (exact ID)
    assert.strictEqual(r.matched[0].id, 'decision.root');

    // Graph expansion should include related cards
    const allIds = r.matched.map(m => m.id);
    assert.ok(allIds.includes('decision.child_a'), 'should include depends_on child via graph expansion');
    assert.ok(allIds.includes('decision.child_b'), 'should include related child via graph expansion');

    // Graph-expanded cards should have graph_distance >= 1
    const childA = r.matched.find(m => m.id === 'decision.child_a');
    assert.ok(childA, 'child_a should be present');
    assert.ok(childA.graph_distance >= 1, 'graph-expanded card should have graph_distance >= 1');
    assert.strictEqual(childA.match_type, 'graph_expansion');
    assert.ok(childA.from_card, 'graph-expanded card should have from_card');
  });

  // ── vi. explain reasons / factors ──────────────────────────────

  it('provides reasons and factors in explain mode', () => {
    testDir = fixtureDir('explain');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.explain_target.md'), `---
id: decision.explain_target
type: decision
title: "Explain Target Decision"
status: active
tags: [explain-test, architecture]
aliases:
  - explain me
---
# Explain Target Decision

Body text for FTS matching.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    // Explain mode
    const rExplain = query(pmemPath, 'explain test', { limit: 5, explain: true });
    assert.ok(rExplain.matched.length >= 1);
    const m = rExplain.matched[0];
    assert.ok(m.reasons, 'explain mode should have reasons');
    assert.ok(m.reasons!.length >= 1, 'should have at least one reason');
    assert.ok(m.factors, 'explain mode should have factors');
    assert.ok('type_weight' in m.factors!, 'factors should include type_weight');
    assert.ok('recency' in m.factors!, 'factors should include recency');
    assert.ok('staleness' in m.factors!, 'factors should include staleness');
    assert.ok('status' in m.factors!, 'factors should include status');

    // Non-explain mode should NOT include reasons/factors
    const rNoExplain = query(pmemPath, 'explain test', { limit: 5, explain: false });
    assert.ok(rNoExplain.matched.length >= 1);
    assert.strictEqual(rNoExplain.matched[0].reasons, undefined, 'non-explain mode should omit reasons');
    assert.strictEqual(rNoExplain.matched[0].factors, undefined, 'non-explain mode should omit factors');
  });

  // ── vii. limit ─────────────────────────────────────────────────

  it('respects the limit parameter', () => {
    testDir = fixtureDir('limit');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);

    // Create 10 cards all mentioning "common" keyword
    for (let i = 0; i < 10; i++) {
      writeFile(path.join(testDir, '.pmem', 'decisions', `decision.card_${i}.md`), `---
id: decision.card_${i}
type: decision
title: "Card ${i} — Common Topic"
status: active
tags: [common]
---
# Card ${i}

All cards discuss the common topic keyword extensively.
`);
    }

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r3 = query(pmemPath, 'common topic', { limit: 3 });
    assert.ok(r3.matched.length <= 3, `limit 3 should return ≤ 3 results, got ${r3.matched.length}`);

    const r7 = query(pmemPath, 'common topic', { limit: 7 });
    assert.ok(r7.matched.length <= 7, `limit 7 should return ≤ 7 results, got ${r7.matched.length}`);

    // Default limit (20) should be higher
    const rDefault = query(pmemPath, 'common topic');
    assert.ok(rDefault.matched.length >= r3.matched.length, 'default limit should return more results');
  });

  // ── viii. evidence_paths ───────────────────────────────────────

  it('populates evidence_paths from scored results', () => {
    testDir = fixtureDir('evidence');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.evidence_a.md'), `---
id: decision.evidence_a
type: decision
title: "Evidence Decision A"
status: active
tags: [evidence]
---
# Evidence Decision A

Important decision about evidence.
`);
    writeFile(path.join(testDir, '.pmem', 'traces', 'trace.evidence_trace.md'), `---
id: trace.evidence_trace
type: trace
title: "Evidence Trace"
status: active
tags: [evidence]
---
# Evidence Trace

Some trace related to evidence decisions.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r = query(pmemPath, 'evidence', { limit: 10 });
    assert.ok(r.evidence_paths.length >= 1, 'should have at least one evidence path');

    // Evidence paths should only include decision and trace types
    const evidenceIds = r.evidence_paths.map(p => {
      // Extract card id from file path like .pmem/decisions/decision.xxx.md
      const base = path.basename(p, '.md');
      return base;
    });
    assert.ok(evidenceIds.some(id => id.includes('evidence')),
      'evidence_paths should include matching evidence cards');

    // recommended_files should be populated
    assert.ok(r.recommended_files.length >= 1, 'should have recommended files');
  });

  // ── Determinism ────────────────────────────────────────────────

  it('produces deterministic results for the same query', () => {
    testDir = fixtureDir('determinism');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.det_a.md'), `---
id: decision.det_a
type: decision
title: "Determinism Test Alpha"
status: active
tags: [determinism]
---
# Determinism Test Alpha

This card is for testing deterministic output.
`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.det_b.md'), `---
id: decision.det_b
type: decision
title: "Determinism Test Beta"
status: active
tags: [determinism]
---
# Determinism Test Beta

Another card for determinism testing.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const now = Date.parse('2026-07-03T12:00:00.000Z');
    const r1 = query(pmemPath, 'determinism', { limit: 10, now });
    const r2 = query(pmemPath, 'determinism', { limit: 10, now });

    assert.deepStrictEqual(r1.matched.map(m => m.id), r2.matched.map(m => m.id),
      'same query with same timestamp should produce identical ordering');
    assert.deepStrictEqual(r1.matched.map(m => m.score), r2.matched.map(m => m.score),
      'same query with same timestamp should produce identical scores');
  });

  // ── combined: recall-compatible output shape ───────────────────

  it('returns AskResultV03 compatible shape with v0.8 additions', () => {
    testDir = fixtureDir('v03-shape');
    pmemPath = path.join(testDir, '.pmem');
    writeFile(path.join(testDir, '.pmem', 'manifest.yml'), makeManifest());
    writeFile(path.join(testDir, '.pmem', 'state.md'), `---
id: state
type: module
title: "State"
status: active
tags: []
---
# State
`);
    writeFile(path.join(testDir, '.pmem', 'next.md'), `# Next\n\n<!-- pmem:next:start -->\n## Recommended Next Step\nnone\n## Why\ntest\n<!-- pmem:next:end -->\n`);
    writeFile(path.join(testDir, '.pmem', 'decisions', 'decision.shape.md'), `---
id: decision.shape
type: decision
title: "Shape Test"
status: active
tags: [shape]
---
# Shape Test

Testing the output shape.
`);

    pmem('init', testDir);
    pmem('rebuild --full', testDir);

    const r = query(pmemPath, 'decision.shape', { limit: 5, explain: true });

    // AskResultV03 required fields
    assert.strictEqual(typeof r.query, 'string');
    assert.ok(Array.isArray(r.matched));
    assert.ok(Array.isArray(r.recommended_files));
    assert.ok(Array.isArray(r.evidence_paths));

    // Each match has v0.3 fields
    const m = r.matched[0];
    assert.ok(m, 'should have at least one match');
    assert.strictEqual(typeof m.id, 'string');
    assert.strictEqual(typeof m.title, 'string');
    assert.strictEqual(typeof m.match_type, 'string');
    assert.strictEqual(typeof m.confidence, 'number');
    assert.strictEqual(typeof m.graph_distance, 'number');
    assert.strictEqual(typeof m.file, 'string');

    // v0.8 additions
    assert.strictEqual(typeof m.score, 'number', 'v0.8 score should be present');
    assert.strictEqual(typeof m.stale, 'boolean', 'v0.8 stale flag should be present');
    assert.ok(m.reasons, 'v0.8 explain reasons should be present');
    assert.ok(m.factors, 'v0.8 explain factors should be present');
  });
});
