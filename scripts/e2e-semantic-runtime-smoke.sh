#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pmem-semantic-runtime.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

PACK_JSON="$TMP_DIR/pack.json"
npm pack --dry-run --json "$ROOT" > "$PACK_JSON"
node - "$PACK_JSON" <<'NODE'
const fs = require('node:fs');
const files = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0].files.map(file => file.path);
for (const expected of ['dist/core/semantic/transformers.js', 'package.json', 'README.md']) {
  if (!files.includes(expected)) throw new Error(`pmem-ai pack is missing ${expected}`);
}
if (files.some(file => file.startsWith('src/') || file.includes('.test.') || file.startsWith('node_modules/'))) {
  throw new Error('pmem-ai pack contains source, test, or node_modules files');
}
NODE

TARBALL="$(npm pack --silent --pack-destination "$TMP_DIR" "$ROOT")"
tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
FIXTURE="$TMP_DIR/package"

node - "$FIXTURE" <<'NODE'
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.argv[2];
const packageJson = require(path.join(root, 'package.json'));
const runtime = require(path.join(root, 'dist/core/semantic/transformers.js'));

assert.equal(packageJson.dependencies['@huggingface/transformers'], '4.3.0');
assert.equal(typeof runtime.assertTransformersRuntimeAvailable, 'function');
assert.equal(typeof runtime.createOfflineTransformersProvider, 'function');

const calls = [];
const env = { allowRemoteModels: true, allowLocalModels: false, cacheDir: 'before' };
const extractor = async (input, options) => {
  calls.push({ input, options, allowRemoteModels: env.allowRemoteModels });
  return { tolist: () => Array.isArray(input) ? input.map(() => [1, 0]) : [1, 0] };
};

(async () => {
  const load = async specifier => {
    assert.equal(specifier, '@huggingface/transformers');
    return {
      env,
      pipeline: async (task, model, options) => {
        assert.equal(task, 'feature-extraction');
        assert.equal(model, path.join(root, 'model-cache'));
        assert.equal(options.local_files_only, true);
        assert.equal(env.allowRemoteModels, false);
        assert.equal(env.allowLocalModels, true);
        return extractor;
      },
    };
  };
  await runtime.assertTransformersRuntimeAvailable(load);
  const provider = await runtime.createOfflineTransformersProvider({
    model: 'fixture/model',
    revision: 'fixture',
    dtype: 'uint8',
    dimension: 2,
    cachePath: path.join(root, 'model-cache'),
  }, load);
  assert.deepEqual(await provider.embedPassages(['memory']), [[1, 0]]);
  assert.deepEqual(await provider.embedQuery('question'), [1, 0]);
  assert.deepEqual(calls.map(call => call.input), [['passage: memory'], 'query: question']);
  assert.ok(calls.every(call => call.options.pooling === 'mean' && call.options.normalize === true));
  assert.ok(calls.every(call => call.allowRemoteModels === false));
  assert.equal(env.allowRemoteModels, true);
  assert.equal(env.allowLocalModels, false);
  assert.equal(env.cacheDir, 'before');
  await provider.dispose();
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE

echo "pmem-ai pack and bundled semantic runtime smoke passed"
