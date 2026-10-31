'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

it('keeps Bun as the only package manager with one lockfile and bundled semantic inference', () => {
  const base = readJson('package.json');

  assert.match(base.version, /^\d+\.\d+\.\d+$/);
  assert.match(base.packageManager ?? '', /^bun@\d+\.\d+\.\d+$/);
  for (const stale of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    assert.equal(
      fs.existsSync(path.join(root, stale)),
      false,
      `${stale} must not exist: bun.lock is the only lockfile`,
    );
  }
  const lock = readText('bun.lock');
  assert.match(lock, /"lockfileVersion": \d+/);
  assert.match(lock, /"name": "pmem-ai"/);
  assert.equal(base.dependencies['@huggingface/transformers'], '4.3.0');
  assert.equal(fs.existsSync(path.join(root, 'packages/semantic-runtime')), false);
  // better-sqlite3 needs its prebuild install; onnxruntime-node's postinstall only
  // downloads CUDA/TensorRT binaries, which the CPU runtime does not use.
  assert.deepEqual(base.trustedDependencies, ['better-sqlite3']);
});

it('keeps install guidance unified, lint/format on oxc, and the changelog aligned with the package version', () => {
  const version = readJson('package.json').version;
  const baseDocs = ['README.md', 'skills/pmem/SKILL.md'].map(readText);

  for (const document of baseDocs) {
    assert.match(document, /pmem-ai@latest/);
    assert.doesNotMatch(document, /pmem-ai-semantic/);
    assert.doesNotMatch(document, /pnpm/);
  }
  const pkg = readJson('package.json');
  assert.match(pkg.scripts.lint, /^oxlint\b/);
  assert.match(pkg.scripts.format, /^oxfmt\b/);
  assert.match(pkg.scripts['format:check'], /^oxfmt --check\b/);
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  assert.ok(fs.existsSync(path.join(root, '.oxlintrc.json')));
  assert.ok(fs.existsSync(path.join(root, '.oxfmtrc.jsonc')));
  assert.match(
    readText('CHANGELOG.md'),
    new RegExp(`^## v${version.replaceAll('.', '\\.')}(?: |$)`, 'm'),
  );
});
