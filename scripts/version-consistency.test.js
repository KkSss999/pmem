'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

it('keeps the base package and lockfile on one release version with bundled semantic inference', () => {
  const base = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.match(base.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, base.version);
  assert.equal(lock.packages[''].version, base.version);
  assert.equal(base.dependencies['@huggingface/transformers'], '4.3.0');
  assert.equal(lock.packages[''].dependencies['@huggingface/transformers'], '4.3.0');
  assert.equal(fs.existsSync(path.join(root, 'packages/semantic-runtime')), false);
});

it('keeps install guidance unified and the changelog aligned with the package version', () => {
  const version = readJson('package.json').version;
  const baseDocs = [
    'README.md',
    'skills/pmem/SKILL.md',
  ].map(readText);

  for (const document of baseDocs) {
    assert.match(document, /npm install -g pmem-ai@latest/);
    assert.doesNotMatch(document, /pmem-ai-semantic/);
  }
  assert.match(readText('CHANGELOG.md'), new RegExp(`^## v${version.replaceAll('.', '\\.')}(?: |$)`, 'm'));
});
