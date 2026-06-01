"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const manifest_1 = require("./manifest");
(0, node_test_1.describe)('getDefaultManifest', () => {
    (0, node_test_1.it)('returns a ManifestV03 with schema_version 0.3', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.strictEqual(manifest.pmem.schema_version, '0.3');
        node_assert_1.default.strictEqual(manifest.pmem.protocol_version, '0.3');
    });
    (0, node_test_1.it)('sets the project name correctly', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.strictEqual(manifest.project.name, 'test-project');
    });
    (0, node_test_1.it)('has v0.3 runtime block', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.runtime);
        node_assert_1.default.strictEqual(manifest.runtime.mode, 'sqlite');
        node_assert_1.default.strictEqual(manifest.runtime.db_path, '.pmem/pmem.db');
        node_assert_1.default.strictEqual(manifest.runtime.markdown_source, true);
    });
    (0, node_test_1.it)('has v0.3 indexes block with sqlite primary', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.indexes);
        node_assert_1.default.strictEqual(manifest.indexes.primary, 'sqlite');
        node_assert_1.default.strictEqual(manifest.indexes.legacy_json.enabled, false);
        node_assert_1.default.strictEqual(manifest.indexes.legacy_json.retained, true);
    });
    (0, node_test_1.it)('has v0.3 rebuild block with content_hash strategy', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.rebuild);
        node_assert_1.default.strictEqual(manifest.rebuild.strategy, 'content_hash');
        node_assert_1.default.strictEqual(manifest.rebuild.hash.file_hash, true);
        node_assert_1.default.strictEqual(manifest.rebuild.hash.frontmatter_hash, true);
        node_assert_1.default.strictEqual(manifest.rebuild.hash.body_hash, true);
    });
    (0, node_test_1.it)('has v0.3 cli block with compact default format', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.cli);
        node_assert_1.default.strictEqual(manifest.cli.default_format, 'compact');
        node_assert_1.default.deepStrictEqual(manifest.cli.supported_formats, ['compact', 'json', 'paths', 'pack']);
        node_assert_1.default.strictEqual(manifest.cli.default_budget, 1600);
    });
    (0, node_test_1.it)('has embedding enabled false', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.embedding);
        node_assert_1.default.strictEqual(manifest.embedding.enabled, false);
        node_assert_1.default.strictEqual(manifest.embedding.provider, 'none');
        node_assert_1.default.strictEqual(manifest.embedding.model, null);
        node_assert_1.default.strictEqual(manifest.embedding.dimension, null);
    });
    (0, node_test_1.it)('has serve enabled false', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.serve);
        node_assert_1.default.strictEqual(manifest.serve.enabled, false);
        node_assert_1.default.strictEqual(manifest.serve.mode, 'none');
        node_assert_1.default.strictEqual(manifest.serve.experimental.mcp, false);
        node_assert_1.default.strictEqual(manifest.serve.experimental.rest, false);
    });
    (0, node_test_1.it)('has required base fields', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.ok(manifest.concurrency);
        node_assert_1.default.strictEqual(manifest.concurrency.mode, 'file-basic');
        node_assert_1.default.ok(manifest.auto_update);
        node_assert_1.default.strictEqual(manifest.auto_update.enabled, true);
        node_assert_1.default.ok(manifest.card_policy);
        node_assert_1.default.ok(manifest.distill);
        node_assert_1.default.ok(manifest.freshness);
        node_assert_1.default.ok(manifest.migrations);
        node_assert_1.default.ok(manifest.memory_status);
        node_assert_1.default.ok(manifest.source_of_truth);
        node_assert_1.default.ok(manifest.integrations);
    });
    (0, node_test_1.it)('guided mode sets completeness to partial', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project', 'guided');
        node_assert_1.default.strictEqual(manifest.memory_status.completeness, 'partial');
        node_assert_1.default.strictEqual(manifest.memory_status.initialized_mode, 'guided');
    });
    (0, node_test_1.it)('minimal mode sets completeness to incomplete', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project', 'minimal');
        node_assert_1.default.strictEqual(manifest.memory_status.completeness, 'incomplete');
    });
    (0, node_test_1.it)('memory_status is not dirty by default', () => {
        const manifest = (0, manifest_1.getDefaultManifest)('test-project');
        node_assert_1.default.strictEqual(manifest.memory_status.dirty, false);
        node_assert_1.default.strictEqual(manifest.memory_status.dirty_since, null);
        node_assert_1.default.strictEqual(manifest.memory_status.dirty_reason, null);
    });
});
(0, node_test_1.describe)('getDefaultManifestV03', () => {
    (0, node_test_1.it)('returns the same result as getDefaultManifest', () => {
        const v1 = (0, manifest_1.getDefaultManifest)('test-project');
        const v2 = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.deepStrictEqual(v1, v2);
    });
    (0, node_test_1.it)('returns ManifestV03 with schema_version 0.3', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.pmem.schema_version, '0.3');
    });
    (0, node_test_1.it)('includes all v0.3 blocks: runtime, rebuild, cli, embedding, serve', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.ok(manifest.runtime, 'runtime block missing');
        node_assert_1.default.ok(manifest.rebuild, 'rebuild block missing');
        node_assert_1.default.ok(manifest.cli, 'cli block missing');
        node_assert_1.default.ok(manifest.embedding, 'embedding block missing');
        node_assert_1.default.ok(manifest.serve, 'serve block missing');
    });
    (0, node_test_1.it)('verify runtime.mode is sqlite', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.runtime.mode, 'sqlite');
    });
    (0, node_test_1.it)('verify indexes.primary is sqlite', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.indexes.primary, 'sqlite');
    });
    (0, node_test_1.it)('verify rebuild.strategy is content_hash', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.rebuild.strategy, 'content_hash');
    });
    (0, node_test_1.it)('verify cli.default_format is compact', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.cli.default_format, 'compact');
    });
    (0, node_test_1.it)('verify embedding.enabled is false', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.embedding.enabled, false);
    });
    (0, node_test_1.it)('verify serve.enabled is false', () => {
        const manifest = (0, manifest_1.getDefaultManifestV03)('test-project');
        node_assert_1.default.strictEqual(manifest.serve.enabled, false);
    });
});
//# sourceMappingURL=manifest.test.js.map