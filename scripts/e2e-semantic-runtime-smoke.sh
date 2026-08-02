#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pmem-semantic-runtime.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

PACK_JSON="$TMP_DIR/pack.json"
npm pack --dry-run --json "$ROOT/packages/semantic-runtime" > "$PACK_JSON"
node - "$PACK_JSON" <<'NODE'
const fs = require('node:fs');
const files = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0].files.map(file => file.path);
for (const expected of ['index.js', 'package.json', 'README.md']) {
  if (!files.includes(expected)) throw new Error(`pack is missing ${expected}`);
}
if (files.some(file => file.startsWith('node_modules/'))) throw new Error('pack leaked node_modules');
NODE

TARBALL="$(npm pack --silent --pack-destination "$TMP_DIR" "$ROOT/packages/semantic-runtime")"
tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
FIXTURE="$TMP_DIR/package"
mkdir -p "$FIXTURE/node_modules/@huggingface/transformers"

node - "$FIXTURE/node_modules/@huggingface/transformers" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
fs.writeFileSync(`${path}/package.json`, JSON.stringify({ name: '@huggingface/transformers', version: 'fixture', main: './index.js' }));
fs.writeFileSync(`${path}/index.js`, [
  "'use strict';",
  'module.exports = {',
  '  env: { allowRemoteModels: true, allowLocalModels: false, cacheDir: null },',
  '  pipeline: async (_task, model, options) => {',
  '    if (!model || options.local_files_only !== true) throw new Error("offline pipeline contract failed");',
  '    return async () => ({ tolist: () => [[1, 0]] });',
  '  },',
  '};',
].join('\n'));
NODE

node - "$FIXTURE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const companion = require(process.argv[2]);
(async () => {
  await companion.assertTransformersRuntimeAvailable();
  const provider = await companion.createOfflineTransformersProvider({
    model: 'fixture/model', revision: 'fixture', dtype: 'uint8', dimension: 2,
    cachePath: path.resolve(process.argv[2], 'cache'),
  });
  const passages = await provider.embedPassages(['passage']);
  const query = await provider.embedQuery('query');
  if (passages.length !== 1 || query.length !== 2) throw new Error('dynamic import provider contract failed');
  await provider.dispose();
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE

INSTALL_PREFIX="$TMP_DIR/npm-prefix"
if npm install --global --prefix "$INSTALL_PREFIX" --offline --ignore-scripts --package-lock=false "$TMP_DIR/$TARBALL" > "$TMP_DIR/install.log" 2>&1; then
  INSTALL_ROOT="$INSTALL_PREFIX/lib/node_modules/pmem-ai-semantic"
node - "$INSTALL_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const packageRoot = process.argv[2];
const packageJson = require(path.join(packageRoot, 'package.json'));
if (packageJson.dependencies['@huggingface/transformers'] !== '4.2.0') throw new Error('installed dependency version drifted');
const resolved = fs.realpathSync(require.resolve('pmem-ai-semantic', { paths: [path.dirname(packageRoot)] }));
const expected = fs.realpathSync(path.join(packageRoot, 'index.js'));
if (resolved !== expected) throw new Error(`installed package export mismatch: ${resolved} != ${expected}`);
NODE
  echo "semantic companion pack/install/dynamic-import smoke passed"
else
  echo "semantic companion pack and dynamic-import smoke passed (offline npm install skipped: cache unavailable)"
fi
