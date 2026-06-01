import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDefaultManifest, getDefaultManifestV03 } from './manifest';

describe('getDefaultManifest', () => {
  it('returns a ManifestV03 with schema_version 0.3', () => {
    const manifest = getDefaultManifest('test-project');
    assert.strictEqual(manifest.pmem.schema_version, '0.3');
    assert.strictEqual(manifest.pmem.protocol_version, '0.3');
  });

  it('sets the project name correctly', () => {
    const manifest = getDefaultManifest('test-project');
    assert.strictEqual(manifest.project.name, 'test-project');
  });

  it('has v0.3 runtime block', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.runtime);
    assert.strictEqual(manifest.runtime.mode, 'sqlite');
    assert.strictEqual(manifest.runtime.db_path, '.pmem/pmem.db');
    assert.strictEqual(manifest.runtime.markdown_source, true);
  });

  it('has v0.3 indexes block with sqlite primary', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.indexes);
    assert.strictEqual(manifest.indexes.primary, 'sqlite');
    assert.strictEqual(manifest.indexes.legacy_json.enabled, false);
    assert.strictEqual(manifest.indexes.legacy_json.retained, true);
  });

  it('has v0.3 rebuild block with content_hash strategy', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.rebuild);
    assert.strictEqual(manifest.rebuild.strategy, 'content_hash');
    assert.strictEqual(manifest.rebuild.hash.file_hash, true);
    assert.strictEqual(manifest.rebuild.hash.frontmatter_hash, true);
    assert.strictEqual(manifest.rebuild.hash.body_hash, true);
  });

  it('has v0.3 cli block with compact default format', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.cli);
    assert.strictEqual(manifest.cli.default_format, 'compact');
    assert.deepStrictEqual(manifest.cli.supported_formats, ['compact', 'json', 'paths', 'pack']);
    assert.strictEqual(manifest.cli.default_budget, 1600);
  });

  it('has embedding enabled false', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.embedding);
    assert.strictEqual(manifest.embedding.enabled, false);
    assert.strictEqual(manifest.embedding.provider, 'none');
    assert.strictEqual(manifest.embedding.model, null);
    assert.strictEqual(manifest.embedding.dimension, null);
  });

  it('has serve enabled false', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.serve);
    assert.strictEqual(manifest.serve.enabled, false);
    assert.strictEqual(manifest.serve.mode, 'none');
    assert.strictEqual(manifest.serve.experimental.mcp, false);
    assert.strictEqual(manifest.serve.experimental.rest, false);
  });

  it('has required base fields', () => {
    const manifest = getDefaultManifest('test-project');
    assert.ok(manifest.concurrency);
    assert.strictEqual(manifest.concurrency.mode, 'file-basic');
    assert.ok(manifest.auto_update);
    assert.strictEqual(manifest.auto_update.enabled, true);
    assert.ok(manifest.card_policy);
    assert.ok(manifest.distill);
    assert.ok(manifest.freshness);
    assert.ok(manifest.migrations);
    assert.ok(manifest.memory_status);
    assert.ok(manifest.source_of_truth);
    assert.ok(manifest.integrations);
  });

  it('guided mode sets completeness to partial', () => {
    const manifest = getDefaultManifest('test-project', 'guided');
    assert.strictEqual(manifest.memory_status.completeness, 'partial');
    assert.strictEqual(manifest.memory_status.initialized_mode, 'guided');
  });

  it('minimal mode sets completeness to incomplete', () => {
    const manifest = getDefaultManifest('test-project', 'minimal');
    assert.strictEqual(manifest.memory_status.completeness, 'incomplete');
  });

  it('memory_status is not dirty by default', () => {
    const manifest = getDefaultManifest('test-project');
    assert.strictEqual(manifest.memory_status.dirty, false);
    assert.strictEqual(manifest.memory_status.dirty_since, null);
    assert.strictEqual(manifest.memory_status.dirty_reason, null);
  });
});

describe('getDefaultManifestV03', () => {
  it('returns the same result as getDefaultManifest', () => {
    const v1 = getDefaultManifest('test-project');
    const v2 = getDefaultManifestV03('test-project');
    assert.deepStrictEqual(v1, v2);
  });

  it('returns ManifestV03 with schema_version 0.3', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.pmem.schema_version, '0.3');
  });

  it('includes all v0.3 blocks: runtime, rebuild, cli, embedding, serve', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.ok(manifest.runtime, 'runtime block missing');
    assert.ok(manifest.rebuild, 'rebuild block missing');
    assert.ok(manifest.cli, 'cli block missing');
    assert.ok(manifest.embedding, 'embedding block missing');
    assert.ok(manifest.serve, 'serve block missing');
  });

  it('verify runtime.mode is sqlite', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.runtime.mode, 'sqlite');
  });

  it('verify indexes.primary is sqlite', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.indexes.primary, 'sqlite');
  });

  it('verify rebuild.strategy is content_hash', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.rebuild.strategy, 'content_hash');
  });

  it('verify cli.default_format is compact', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.cli.default_format, 'compact');
  });

  it('verify embedding.enabled is false', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.embedding.enabled, false);
  });

  it('verify serve.enabled is false', () => {
    const manifest = getDefaultManifestV03('test-project');
    assert.strictEqual(manifest.serve.enabled, false);
  });
});
