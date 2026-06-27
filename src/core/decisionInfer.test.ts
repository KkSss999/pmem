import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferDecisions } from './decisionInfer';

function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function rmrf(p: string): void {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function makeTempPmem(): string {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-decision-infer-'));
  const pmemPath = path.join(tmpRoot, '.pmem');
  mkdirp(pmemPath);
  return pmemPath;
}

// --- Test 1: Empty project (no .pmem/traces/) ---

describe('inferDecisions — empty project', () => {
  let pmemPath: string;

  before(() => {
    pmemPath = makeTempPmem();
  });

  after(() => {
    rmrf(path.join(pmemPath, '..'));
  });

  it('returns empty result with trace_dir_exists=false when traces dir is missing', () => {
    const result = inferDecisions(pmemPath);

    assert.deepEqual(result.decisions, []);
    assert.equal(result.diagnostics.trace_dir_exists, false);
    assert.equal(result.diagnostics.traces_scanned, 0);
    assert.equal(result.diagnostics.traces_with_decisions, 0);
    assert.equal(result.diagnostics.decision_lines_found, 0);
    assert.equal(result.diagnostics.candidates_above_threshold, 0);
  });
});

// --- Test 2: Traces dir exists but no ## Decision sections ---

describe('inferDecisions — traces exist but lack ## Decision sections', () => {
  let pmemPath: string;
  let tracesDir: string;

  before(() => {
    pmemPath = makeTempPmem();
    tracesDir = path.join(pmemPath, 'traces');
    mkdirp(tracesDir);

    const noDecisionTrace = `---
id: trace.no_decisions
type: trace
created: 2026-06-28
source_files: []
---

# Trace Without Decisions

## Summary
Just a regular trace, no decisions inside.

## What changed
- src/foo.ts

## Why
- Because reasons.
`;
    fs.writeFileSync(path.join(tracesDir, '2026-06-28_no_decisions.md'), noDecisionTrace);
  });

  after(() => {
    rmrf(path.join(pmemPath, '..'));
  });

  it('counts scanned traces but reports zero decision lines when no ## Decision sections present', () => {
    const result = inferDecisions(pmemPath);

    assert.deepEqual(result.decisions, []);
    assert.equal(result.diagnostics.trace_dir_exists, true);
    assert.equal(result.diagnostics.traces_scanned, 1);
    assert.equal(result.diagnostics.traces_with_decisions, 0);
    assert.equal(result.diagnostics.decision_lines_found, 0);
    assert.equal(result.diagnostics.candidates_above_threshold, 0);
  });
});

// --- Test 3: Traces with ## Decision sections ---

describe('inferDecisions — traces with ## Decision sections', () => {
  let pmemPath: string;
  let tracesDir: string;

  before(() => {
    pmemPath = makeTempPmem();
    tracesDir = path.join(pmemPath, 'traces');
    mkdirp(tracesDir);

    const traceWithDecisions = `---
id: trace.with_decisions
type: trace
created: 2026-06-28
source_files:
  - src/App.tsx
  - src/engine/foo.ts
---

# Trace With Decisions

## Summary
A trace that records an architectural decision.

## What changed
- src/App.tsx

## Why
- We need consistent rendering.

## Decisions
- Adopt a single-file render pipeline
- Cache module lookups at boot
`;
    fs.writeFileSync(path.join(tracesDir, '2026-06-28_with_decisions.md'), traceWithDecisions);
  });

  after(() => {
    rmrf(path.join(pmemPath, '..'));
  });

  it('parses decision lines, returns inferred decisions and populates diagnostics', () => {
    const result = inferDecisions(pmemPath);

    assert.equal(result.diagnostics.trace_dir_exists, true);
    assert.equal(result.diagnostics.traces_scanned, 1);
    assert.equal(result.diagnostics.traces_with_decisions, 1);
    assert.equal(result.diagnostics.decision_lines_found, 2);
    assert.equal(result.diagnostics.candidates_above_threshold, 2);
    assert.equal(result.decisions.length, 2);

    const ids = result.decisions.map(d => d.id).sort();
    assert.ok(ids.includes('decision.adopt_a_single_file_render_pipeline'));
    assert.ok(ids.includes('decision.cache_module_lookups_at_boot'));

    for (const d of result.decisions) {
      assert.equal(d.evidence.length, 1);
      assert.equal(d.evidence[0], 'trace.with_decisions');
    }
  });

  it('still returns the diagnostics object when verbose flag is false', () => {
    const result = inferDecisions(pmemPath, { verbose: false });
    assert.ok(result.diagnostics, 'diagnostics must always be present');
    assert.equal(typeof result.diagnostics.traces_scanned, 'number');
  });
});
