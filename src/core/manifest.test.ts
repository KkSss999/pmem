import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDefaultManifest, getDefaultManifestV03, resolveConfig, renderIdPattern, V064_DEFAULT_TYPES, V064_DEFAULT_MERGE_TYPES, V064_DEFAULT_CREATABLE_TYPES } from './manifest';

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

// v0.7.0 Phase 1 — resolved config and id_pattern rendering

describe('resolveConfig', () => {
  it('falls back to v0.6.4 defaults when manifest has no schema', () => {
    const manifest = getDefaultManifest('test-project');
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.card_types, V064_DEFAULT_TYPES);
    assert.strictEqual(cfg.foundational_types[0], 'module');
    assert.strictEqual(cfg.default_type, 'trace');
    assert.deepStrictEqual(cfg.evidence_types, ['decision', 'trace']);
    assert.deepStrictEqual(cfg.merge_target_types, V064_DEFAULT_MERGE_TYPES);
  });

  it('uses custom card_types from schema when declared', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).schema = { card_types: ['character', 'chapter', 'trace'] };
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.card_types, ['character', 'chapter', 'trace']);
  });

  it('uses custom foundational_types from schema when declared', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).schema = { foundational_types: ['character'] };
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.foundational_types, ['character']);
  });

  it('reads merge_target_types from distill, not schema', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).distill = { ...manifest.distill, merge_target_types: ['module', 'character'] };
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.merge_target_types, ['module', 'character']);
  });

  it('falls back merge_target_types to v0.6.4 when distill has none', () => {
    const manifest = getDefaultManifest('test-project');
    // Default manifest distill has no merge_target_types
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.merge_target_types, V064_DEFAULT_MERGE_TYPES);
  });

  it('type_dirs defaults to ${type}s for types not in schema.type_dirs', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).schema = { card_types: ['custom_foo', 'module'] };
    const cfg = resolveConfig(manifest);
    assert.strictEqual(cfg.type_dirs['custom_foo'], 'custom_foos');
    assert.strictEqual(cfg.type_dirs['module'], 'modules');
  });

  it('type_dirs uses explicit mapping from schema when declared', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).schema = {
      card_types: ['world'],
      type_dirs: { world: 'world' },
    };
    const cfg = resolveConfig(manifest);
    assert.strictEqual(cfg.type_dirs['world'], 'world');
  });

  it('does not mutate the original manifest object', () => {
    const manifest = getDefaultManifest('test-project');
    const snapshot = JSON.stringify(manifest);
    resolveConfig(manifest);
    assert.strictEqual(JSON.stringify(manifest), snapshot);
  });

  it('v0.6.4 fallback card_types matches id_pattern whitelist (10 types)', () => {
    assert.deepStrictEqual(V064_DEFAULT_TYPES, [
      'project', 'module', 'feature', 'task', 'decision',
      'trace', 'risk', 'assumption', 'resource', 'integration',
    ]);
  });
});

describe('creatable_types', () => {
  it('old project (no schema) falls back to v0.6.4 VALID_TYPES (6 types)', () => {
    const manifest = getDefaultManifest('test-project');
    const cfg = resolveConfig(manifest);
    assert.deepStrictEqual(cfg.creatable_types, V064_DEFAULT_CREATABLE_TYPES);
    assert.deepStrictEqual(V064_DEFAULT_CREATABLE_TYPES, [
      'decision', 'module', 'task', 'feature', 'risk', 'trace',
    ]);
  });

  it('old project rejects project/assumption/resource/integration (in id_pattern but not creatable)', () => {
    const manifest = getDefaultManifest('test-project');
    const cfg = resolveConfig(manifest);
    assert.ok(!cfg.creatable_types.includes('project'));
    assert.ok(!cfg.creatable_types.includes('assumption'));
    assert.ok(!cfg.creatable_types.includes('resource'));
    assert.ok(!cfg.creatable_types.includes('integration'));
  });

  it('old project accepts module (still creatable)', () => {
    const manifest = getDefaultManifest('test-project');
    const cfg = resolveConfig(manifest);
    assert.ok(cfg.creatable_types.includes('module'));
    assert.ok(cfg.creatable_types.includes('decision'));
  });

  it('custom schema: all declared card_types are creatable except integration', () => {
    const manifest = getDefaultManifest('test-project');
    (manifest as any).schema = {
      card_types: ['character', 'chapter', 'world', 'arc', 'decision', 'integration'],
    };
    const cfg = resolveConfig(manifest);
    assert.ok(cfg.creatable_types.includes('character'));
    assert.ok(cfg.creatable_types.includes('chapter'));
    assert.ok(cfg.creatable_types.includes('world'));
    assert.ok(cfg.creatable_types.includes('arc'));
    assert.ok(cfg.creatable_types.includes('decision'));
    assert.ok(!cfg.creatable_types.includes('integration'), 'integration always excluded');
  });
});

describe('renderIdPattern', () => {
  it('returns pattern unchanged when no {types} placeholder', () => {
    const pattern = '^(project|module)\\.[a-z0-9._-]+$';
    assert.strictEqual(renderIdPattern(pattern, []), pattern);
  });

  it('renders {types} as regex alternation', () => {
    const pattern = '^({types})\\.[a-z0-9._-]+$';
    const result = renderIdPattern(pattern, ['project', 'module', 'character']);
    assert.ok(result.includes('project|module|character'));
    assert.ok(!result.includes('{types}'));
  });

  it('escapes regex special characters in type names', () => {
    const pattern = '^({types})\\.[a-z0-9._-]+$';
    const result = renderIdPattern(pattern, ['c++', 'my.type', 'dot.net']);
    assert.ok(result.includes('c\\+\\+'));
    assert.ok(result.includes('my\\.type'));
    assert.ok(result.includes('dot\\.net'));
  });

  it('single type renders without pipe', () => {
    const pattern = '^({types})\\..+$';
    const result = renderIdPattern(pattern, ['character']);
    assert.strictEqual(result, '^(character)\\..+$');
  });
});
