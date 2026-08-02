import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { maintainCommand, type MaintainSemanticRunner } from './maintain';

const tempDirs: string[] = [];

function project(options: { semantic?: boolean } = {}): { cwd: string; cardPath: string; dbPath: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-maintain-'));
  tempDirs.push(cwd);
  const pmemPath = path.join(cwd, '.pmem');
  fs.mkdirSync(path.join(pmemPath, 'modules'), { recursive: true });
  const manifest = getDefaultManifest('maintain-test');
  if (options.semantic) manifest.embedding.enabled = true;
  saveManifest(pmemPath, manifest);
  const cardPath = path.join(pmemPath, 'modules', 'core.md');
  fs.writeFileSync(cardPath, `---
id: module.core
type: module
title: Core
summary: Core module
---

Body
`, 'utf8');
  const dbPath = path.join(pmemPath, 'pmem.db');
  fs.writeFileSync(dbPath, 'db sentinel', 'utf8');
  return { cwd, cardPath, dbPath };
}

function migrationChoices() {
  return {
    trustLabel: 'user_confirmed',
    sensitivity: 'internal',
    classificationByType: 'module=fact',
  };
}

function fakeRebuild(calls: string[]) {
  return () => { calls.push('rebuild'); };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('maintain command orchestration', () => {
  it('dry-run returns card/field changes and does not touch Markdown, manifest, or DB', async () => {
    const { cwd, cardPath, dbPath } = project();
    const manifestPath = path.join(cwd, '.pmem', 'manifest.yml');
    const before = [cardPath, manifestPath, dbPath].map(file => fs.readFileSync(file));
    const result = await maintainCommand({ cwd, dryRun: true, format: 'json', ...migrationChoices() }, { log: () => {} });

    assert.equal(result.status, 'dry-run');
    assert.equal(result.phase, 'complete');
    assert.equal(result.migration?.changed, 1);
    assert.deepEqual(result.migration?.cards[0].add, {
      classification: 'fact',
      trust_label: 'user_confirmed',
      sensitivity: 'internal',
    });
    assert.deepEqual([cardPath, manifestPath, dbPath].map(file => fs.readFileSync(file)), before);
  });

  it('reports a missing project as a structured failure', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-maintain-empty-'));
    tempDirs.push(cwd);
    const output: string[] = [];
    const result = await maintainCommand({ cwd, dryRun: true, format: 'json' }, { log: line => output.push(line) });

    assert.equal(result.status, 'failed');
    assert.equal(result.phase, 'preflight');
    assert.match(result.errors[0], /No \.pmem directory found/);
    assert.equal(JSON.parse(output[0]).status, 'failed');
  });

  it('rejects --yes without --repair as a failed invalid invocation', async () => {
    const { cwd, cardPath } = project();
    const before = fs.readFileSync(cardPath, 'utf8');
    const output: string[] = [];
    const result = await maintainCommand({ cwd, yes: true, format: 'json' }, { log: line => output.push(line) });

    assert.equal(result.status, 'failed');
    assert.equal(result.phase, 'preflight');
    assert.match(result.errors[0], /--yes requires --repair/);
    assert.equal(JSON.parse(output[0]).status, 'failed');
    assert.equal(fs.readFileSync(cardPath, 'utf8'), before);
  });

  it('exits non-zero when the CLI receives --yes without --repair', () => {
    const { cwd } = project();
    const cli = path.resolve(process.cwd(), 'dist/index.js');
    const result = spawnSync(process.execPath, [cli, 'maintain', '--yes', '--format', 'json'], {
      cwd,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'failed');
    assert.match(result.stdout, /--yes requires --repair/);
  });

  it('requires --yes for repair and does not invoke any mutating stage', async () => {
    const { cwd, cardPath } = project();
    const before = fs.readFileSync(cardPath, 'utf8');
    const calls: string[] = [];
    const result = await maintainCommand({ cwd, repair: true, ...migrationChoices() }, {
      rebuildCommand: fakeRebuild(calls),
      log: () => {},
    });

    assert.equal(result.status, 'cancelled');
    assert.deepEqual(calls, []);
    assert.equal(fs.readFileSync(cardPath, 'utf8'), before);
  });

  it('blocks apply when migration choices are unresolved', async () => {
    const { cwd, cardPath } = project();
    const before = fs.readFileSync(cardPath, 'utf8');
    const calls: string[] = [];
    const result = await maintainCommand({ cwd, repair: true, yes: true }, {
      rebuildCommand: fakeRebuild(calls),
      log: () => {},
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.phase, 'migration');
    assert.equal(result.migration?.unresolved, 1);
    assert.deepEqual(calls, []);
    assert.equal(fs.readFileSync(cardPath, 'utf8'), before);
  });

  it('applies migration, uses the existing backup path, and skips disabled semantic retrieval', async () => {
    const { cwd, cardPath } = project();
    const calls: string[] = [];
    const semantic: MaintainSemanticRunner = {
      rebuild: async () => { calls.push('semantic'); return {}; },
      status: async () => ({}),
    };
    const result = await maintainCommand({ cwd, repair: true, yes: true, ...migrationChoices() }, {
      rebuildCommand: fakeRebuild(calls),
      semantic,
      log: () => {},
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.rebuild.status, 'completed');
    assert.equal(result.semantic.status, 'skipped');
    assert.deepEqual(calls, ['rebuild']);
    assert.match(fs.readFileSync(cardPath, 'utf8'), /trust_label: user_confirmed/);
    assert.ok(result.migration?.backup_path);
  });

  it('marks semantic exceptions failed and explicitly reports the cross-stage rollback limit', async () => {
    const { cwd } = project({ semantic: true });
    const calls: string[] = [];
    const result = await maintainCommand({ cwd, repair: true, yes: true, semantic: true, ...migrationChoices() }, {
      rebuildCommand: fakeRebuild(calls),
      semantic: {
        rebuild: async () => { throw new Error('provider interrupted'); },
        status: async () => ({}),
      },
      log: () => {},
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.phase, 'semantic');
    assert.equal(result.semantic.status, 'failed');
    assert.match(result.errors[0], /provider interrupted/);
    assert.ok(result.recovery.some(line => /Cross-stage rollback is not available/.test(line)));
    assert.deepEqual(calls, ['rebuild']);
  });

  it('fails closed for partial and zero-card semantic results', async () => {
    const cases: MaintainSemanticRunner[] = [
      {
        rebuild: async () => ({ indexedCards: 2, indexedChunks: 4 }),
        status: async () => ({ buildStatus: 'partial', cardsFailed: 1, failedCardIds: ['module.bad'], indexedCards: 2, indexedChunks: 4 }),
      },
      {
        rebuild: async () => ({ indexedCards: 0, indexedChunks: 0 }),
        status: async () => ({ buildStatus: 'complete', indexedCards: 0, indexedChunks: 0 }),
      },
    ];
    for (const semantic of cases) {
      const { cwd } = project({ semantic: true });
      const result = await maintainCommand({ cwd, repair: true, yes: true, semantic: true, ...migrationChoices() }, {
        rebuildCommand: () => {},
        semantic,
        log: () => {},
      });
      assert.equal(result.status, 'failed');
      assert.equal(result.phase, 'semantic');
      assert.equal(result.semantic.status, 'failed');
      fs.rmSync(cwd, { recursive: true, force: true });
      tempDirs.splice(tempDirs.indexOf(cwd), 1);
    }
  });
});
