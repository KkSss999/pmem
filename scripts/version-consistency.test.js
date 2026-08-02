'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

it('keeps the base package, lockfile, and semantic companion on one release version', () => {
  const base = readJson('package.json');
  const lock = readJson('package-lock.json');
  const companion = readJson('packages/semantic-runtime/package.json');

  assert.match(base.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, base.version);
  assert.equal(lock.packages[''].version, base.version);
  assert.equal(companion.version, base.version);
});

it('keeps current install guidance and changelog heading on the release version', () => {
  const version = readJson('package.json').version;
  const baseDocs = [
    'README.md',
    'skills/pmem/SKILL.md',
  ].map(readText);

  for (const document of baseDocs) {
    assert.match(document, new RegExp(`pmem-ai@${version.replaceAll('.', '\\.')}`));
    assert.match(document, new RegExp(`pmem-ai-semantic@${version.replaceAll('.', '\\.')}`));
  }
  assert.match(
    readText('packages/semantic-runtime/README.md'),
    new RegExp(`pmem-ai-semantic@${version.replaceAll('.', '\\.')}`),
  );
  assert.match(readText('CHANGELOG.md'), new RegExp(`^## v${version.replaceAll('.', '\\.')}(?: |$)`, 'm'));
});
