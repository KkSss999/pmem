/**
 * v0.7.0 Phase 2: Focused CLI tests for `pmem init` domain presets behavior.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'js-yaml';

const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-init-test-${Date.now()}`);

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

describe('pmem init domain presets', () => {
  before(() => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('fresh minimal init builds the first index and is immediately ready for ask/context', () => {
    const testDir = path.join(TEMP_ROOT, 'init-zero-step');
    fs.mkdirSync(testDir, { recursive: true });

    const r = pmem('init zero-step', testDir);
    assert.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);
    assert.ok(r.stdout.includes('Building first local index...'), r.stdout);
    assert.ok(r.stdout.includes('pmem is ready for project "zero-step"'), r.stdout);
    assert.ok(r.stdout.includes('pmem context "<your task>"'), r.stdout);
    assert.ok(r.stdout.includes('pmem sync -s "<what changed>" -n "<next step>"'), r.stdout);
    assert.ok(!r.stdout.includes('Next: run `pmem rebuild`'), r.stdout);

    const pmemDir = path.join(testDir, '.pmem');
    assert.ok(fs.existsSync(path.join(pmemDir, 'pmem.db')), 'init should create the SQLite index');
    assert.ok(fs.existsSync(path.join(pmemDir, 'indexes', 'graph.json')), 'init should create graph.json');

    const ask = pmem('ask "first module" --format compact', testDir);
    assert.strictEqual(ask.code, 0, `ask should be ready immediately: ${ask.stdout}\n${ask.stderr}`);
    assert.ok(!ask.stdout.includes('Run `pmem rebuild` first'), ask.stdout);

    const context = pmem('context "create the first module" --format compact', testDir);
    assert.strictEqual(context.code, 0, `context should be ready immediately: ${context.stdout}\n${context.stderr}`);
    assert.ok(context.stdout.includes('# PMEM_CONTEXT_READY: create the first module'), context.stdout);
    assert.ok(context.stdout.includes('**Project**: zero-step'), context.stdout);
  });

  it('default pmem init is software domain (non-interactive)', () => {
    const testDir = path.join(TEMP_ROOT, 'init-default');
    fs.mkdirSync(testDir, { recursive: true });

    // Non-interactive guided init to populate fields
    const r = pmem('init my-software --guided --description "software desc" --stage "MVP" --next "Build core"', testDir);
    assert.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);

    const pmemDir = path.join(testDir, '.pmem');
    assert.ok(fs.existsSync(pmemDir), '.pmem should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'pmem.db')), 'init should build the first SQLite index');
    assert.ok(fs.existsSync(path.join(pmemDir, 'modules')), 'modules directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'features')), 'features directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'tasks')), 'tasks directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');

    // Parse manifest.yml
    const manifestPath = path.join(pmemDir, 'manifest.yml');
    assert.ok(fs.existsSync(manifestPath), 'manifest.yml should exist');
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;

    assert.strictEqual(manifest.project.domain, 'software');
    assert.deepStrictEqual(manifest.schema.card_types, [
      'project', 'module', 'feature', 'task', 'decision',
      'trace', 'risk', 'assumption', 'resource', 'integration'
    ]);
    assert.strictEqual(manifest.schema.default_type, 'trace');
    assert.deepStrictEqual(manifest.schema.foundational_types, ['module']);
    assert.deepStrictEqual(manifest.source_of_truth.card_globs, [
      '.pmem/modules/**/*.md',
      '.pmem/features/**/*.md',
      '.pmem/decisions/**/*.md',
      '.pmem/tasks/**/*.md',
      '.pmem/traces/**/*.md',
      '.pmem/risks/**/*.md'
    ]);

    // Test pmem new validation
    const rNew = pmem('new module "Auth"', testDir);
    assert.strictEqual(rNew.code, 0, `new module should succeed, got output: ${rNew.stdout}\n${rNew.stderr}`);
    assert.ok(fs.existsSync(path.join(pmemDir, 'modules')), 'modules dir should contain the new card');
    const newFiles = fs.readdirSync(path.join(pmemDir, 'modules'));
    assert.ok(newFiles.some(f => f.startsWith('module.auth_')), 'should write card to modules');

    // Ensure directory is in card_globs
    const hasGlob = manifest.source_of_truth.card_globs.some((g: string) => g.includes('modules'));
    assert.ok(hasGlob, 'modules directory must be covered by card_globs');

    // software domain rejects project/assumption/resource/integration/character
    for (const badType of ['project', 'assumption', 'resource', 'integration', 'character']) {
      const rBadNew = pmem(`new ${badType} "Test"`, testDir);
      assert.strictEqual(rBadNew.code, 2, `${badType} should be rejected on software domain`);
      assert.ok(rBadNew.stdout.includes(`Invalid card type "${badType}"`));
    }
  });

  it('init --domain novel creates novel directory structure and writes schema metadata', () => {
    const testDir = path.join(TEMP_ROOT, 'init-novel');
    fs.mkdirSync(testDir, { recursive: true });

    const r = pmem('init my-novel --domain novel --guided --description "novel desc" --stage "Outline" --next "Chapter 1"', testDir);
    assert.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);

    const pmemDir = path.join(testDir, '.pmem');
    assert.ok(fs.existsSync(pmemDir), '.pmem should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'characters')), 'characters directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'chapters')), 'chapters directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'world')), 'world directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'arc')), 'arc directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');

    // Parse manifest.yml
    const manifestPath = path.join(pmemDir, 'manifest.yml');
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;

    assert.strictEqual(manifest.project.domain, 'novel');
    assert.deepStrictEqual(manifest.schema.card_types, [
      'project', 'character', 'chapter', 'world', 'arc', 'decision', 'trace'
    ]);
    assert.deepStrictEqual(manifest.schema.foundational_types, ['character', 'chapter']);
    assert.deepStrictEqual(manifest.card_policy.warn_when_related_count_gt_by_type, {
      character: 30,
      chapter: 25,
      world: 25,
    });
    assert.deepStrictEqual(manifest.source_of_truth.card_globs, [
      '.pmem/characters/**/*.md',
      '.pmem/chapters/**/*.md',
      '.pmem/world/**/*.md',
      '.pmem/arc/**/*.md',
      '.pmem/decisions/**/*.md',
      '.pmem/traces/**/*.md'
    ]);

    // Test that all creatable types under novel domain succeed and directories are in card_globs
    for (const validType of ['character', 'chapter', 'world', 'arc']) {
      const rNew = pmem(`new ${validType} "My ${validType}"`, testDir);
      assert.strictEqual(rNew.code, 0, `new ${validType} should succeed`);
      
      const typeDir = manifest.schema.type_dirs[validType];
      assert.ok(typeDir, `should have type_dir for ${validType}`);
      assert.ok(fs.existsSync(path.join(pmemDir, typeDir)), `${typeDir} dir should exist`);
      
      // Confirm the file is in card_globs coverage
      const globPath = `.pmem/${typeDir}/**/*.md`;
      assert.ok(manifest.source_of_truth.card_globs.includes(globPath), `${globPath} should be in card_globs`);
    }

    // novel domain rejects project
    const rBadNew = pmem('new project "My Project"', testDir);
    assert.strictEqual(rBadNew.code, 2, 'project should be rejected on novel domain');
  });

  it('init --domain research creates research directory structure', () => {
    const testDir = path.join(TEMP_ROOT, 'init-research');
    fs.mkdirSync(testDir, { recursive: true });

    const r = pmem('init my-research --domain research --guided --description "research desc" --stage "Initial research" --next "Literature review"', testDir);
    assert.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);

    const pmemDir = path.join(testDir, '.pmem');
    assert.ok(fs.existsSync(pmemDir), '.pmem should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'sources')), 'sources directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'claims')), 'claims directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'notes')), 'notes directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'experiments')), 'experiments directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
    assert.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');

    // Parse manifest.yml
    const manifestPath = path.join(pmemDir, 'manifest.yml');
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;

    assert.strictEqual(manifest.project.domain, 'research');
    assert.deepStrictEqual(manifest.schema.card_types, [
      'project', 'source', 'claim', 'note', 'experiment', 'decision', 'trace'
    ]);
    assert.deepStrictEqual(manifest.schema.foundational_types, ['source', 'claim']);
    assert.deepStrictEqual(manifest.card_policy.warn_when_related_count_gt_by_type, {
      source: 20,
      claim: 20,
    });
    assert.deepStrictEqual(manifest.source_of_truth.card_globs, [
      '.pmem/sources/**/*.md',
      '.pmem/claims/**/*.md',
      '.pmem/notes/**/*.md',
      '.pmem/experiments/**/*.md',
      '.pmem/decisions/**/*.md',
      '.pmem/traces/**/*.md'
    ]);

    // Test that all creatable types under research domain succeed and directories are in card_globs
    for (const validType of ['source', 'claim', 'note', 'experiment']) {
      const rNew = pmem(`new ${validType} "My ${validType}"`, testDir);
      assert.strictEqual(rNew.code, 0, `new ${validType} should succeed`);
      
      const typeDir = manifest.schema.type_dirs[validType];
      assert.ok(typeDir, `should have type_dir for ${validType}`);
      assert.ok(fs.existsSync(path.join(pmemDir, typeDir)), `${typeDir} dir should exist`);
      
      // Confirm the file is in card_globs coverage
      const globPath = `.pmem/${typeDir}/**/*.md`;
      assert.ok(manifest.source_of_truth.card_globs.includes(globPath), `${globPath} should be in card_globs`);
    }

    // research domain rejects project
    const rBadNew = pmem('new project "My Project"', testDir);
    assert.strictEqual(rBadNew.code, 2, 'project should be rejected on research domain');
  });

  it('fresh init output templates contain correct exits 0 update --suggest semantics', () => {
    const testDir = path.join(TEMP_ROOT, 'init-templates-check');
    fs.mkdirSync(testDir, { recursive: true });

    const r = pmem('init templates-check --guided --description "desc" --stage "stage" --next "next"', testDir);
    assert.strictEqual(r.code, 0);

    const checkNoExit1 = (filePath: string) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lower = content.toLowerCase();
      assert.ok(!lower.includes('exit code 1'), `File ${filePath} should not contain 'exit code 1'`);
      assert.ok(!lower.includes('exits with code 1'), `File ${filePath} should not contain 'exits with code 1'`);
      assert.ok(!lower.includes('exits 1'), `File ${filePath} should not contain 'exits 1'`);
      assert.ok(lower.includes('exits 0'), `File ${filePath} should contain 'exits 0'`);
    };

    checkNoExit1(path.join(testDir, 'AGENTS.md'));
    checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'claude-code', 'CLAUDE.md'));
    checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'cursor', 'rules.example.md'));
    checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'codex', 'AGENTS.md'));

    for (const filePath of [
      path.join(testDir, 'AGENTS.md'),
      path.join(testDir, '.pmem', 'skills', 'task.md'),
      path.join(testDir, '.pmem', 'integrations', 'claude-code', 'CLAUDE.md'),
      path.join(testDir, '.pmem', 'integrations', 'cursor', 'rules.example.md'),
      path.join(testDir, '.pmem', 'integrations', 'codex', 'AGENTS.md'),
    ]) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('pmem context'), `${filePath} should lead with task context`);
      assert.ok(content.includes('pmem sync'), `${filePath} should use the one-command sync closeout`);
    }
  });

  it('keeps the existing-project refusal and does not replace an initialized project', () => {
    const testDir = path.join(TEMP_ROOT, 'init-existing');
    fs.mkdirSync(testDir, { recursive: true });

    const first = pmem('init original', testDir);
    assert.strictEqual(first.code, 0, first.stderr);
    const manifestPath = path.join(testDir, '.pmem', 'manifest.yml');
    const before = fs.readFileSync(manifestPath, 'utf8');

    const second = pmem('init replacement --domain novel', testDir);
    assert.strictEqual(second.code, 0, second.stderr);
    assert.ok(second.stdout.includes('.pmem already exists'), second.stdout);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before, 'second init must not mutate the project');
  });

  it('rejects unknown domain preset with exit 2', () => {
    const testDir = path.join(TEMP_ROOT, 'init-unknown');
    fs.mkdirSync(testDir, { recursive: true });

    const r = pmem('init my-project --domain sci-fi --guided --description "scifi desc" --stage "Initial" --next "Plan"', testDir);
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
    assert.ok(r.stderr.includes('Invalid domain "sci-fi"'), `stderr should contain invalid domain warning: ${r.stderr}`);
    assert.ok(r.stderr.includes('Valid domains are: software, novel, research'), `stderr should show valid options: ${r.stderr}`);
  });
});
