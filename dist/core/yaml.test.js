"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const yaml_1 = require("./yaml");
(0, node_test_1.describe)('parseYamlValue', () => {
    (0, node_test_1.it)('parses strings', () => {
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('hello'), 'hello');
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('hello world'), 'hello world');
    });
    (0, node_test_1.it)('parses booleans', () => {
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('true'), true);
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('false'), false);
    });
    (0, node_test_1.it)('parses numbers', () => {
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('0'), 0);
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('123'), 123);
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('999'), 999);
    });
    (0, node_test_1.it)('parses inline arrays', () => {
        node_assert_1.default.deepStrictEqual((0, yaml_1.parseYamlValue)('[a, b, c]'), ['a', 'b', 'c']);
        node_assert_1.default.deepStrictEqual((0, yaml_1.parseYamlValue)('[foo, bar]'), ['foo', 'bar']);
    });
    (0, node_test_1.it)('parses empty inline array as empty array', () => {
        const result = (0, yaml_1.parseYamlValue)('[]');
        node_assert_1.default.ok(Array.isArray(result));
        node_assert_1.default.strictEqual(result.length, 0);
        // Ensure it is NOT ['']
        node_assert_1.default.deepStrictEqual(result, []);
    });
    (0, node_test_1.it)('parses single-element inline array', () => {
        node_assert_1.default.deepStrictEqual((0, yaml_1.parseYamlValue)('[only]'), ['only']);
    });
    (0, node_test_1.it)('parses quoted strings', () => {
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('"hello"'), 'hello');
        node_assert_1.default.strictEqual((0, yaml_1.parseYamlValue)('"quoted string"'), 'quoted string');
    });
    (0, node_test_1.it)('parses quoted strings inside arrays', () => {
        node_assert_1.default.deepStrictEqual((0, yaml_1.parseYamlValue)('["hello", world]'), ['hello', 'world']);
    });
});
(0, node_test_1.describe)('parseSimpleYaml', () => {
    (0, node_test_1.it)('parses simple key-value pairs', () => {
        const result = (0, yaml_1.parseSimpleYaml)('key: value');
        node_assert_1.default.deepStrictEqual(result, { key: 'value' });
    });
    (0, node_test_1.it)('parses nested objects', () => {
        const yaml = [
            'person:',
            '  name: John',
            '  age: 30',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result, {
            person: { name: 'John', age: 30 },
        });
    });
    (0, node_test_1.it)('parses list items', () => {
        const yaml = [
            'tags:',
            '  - tag1',
            '  - tag2',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result, {
            tags: ['tag1', 'tag2'],
        });
    });
    (0, node_test_1.it)('parses list items with single nesting level', () => {
        const yaml = [
            'tags:',
            '  - dev',
            '  - js',
            '  - ops',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result, {
            tags: ['dev', 'js', 'ops'],
        });
    });
    (0, node_test_1.it)('parses top-level values with different types', () => {
        const yaml = [
            'id: test.id',
            'type: feature',
            'priority: high',
            'version: 3',
            'active: true',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.strictEqual(result.id, 'test.id');
        node_assert_1.default.strictEqual(result.type, 'feature');
        node_assert_1.default.strictEqual(result.priority, 'high');
        node_assert_1.default.strictEqual(result.version, 3);
        node_assert_1.default.strictEqual(result.active, true);
    });
    (0, node_test_1.it)('parses depends_on with empty inline array', () => {
        const yaml = [
            'id: test.id',
            'depends_on: []',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result.depends_on, []);
    });
    (0, node_test_1.it)('parses depends_on with items via list syntax', () => {
        const yaml = [
            'depends_on:',
            '  - card-a',
            '  - card-b',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result.depends_on, ['card-a', 'card-b']);
    });
    (0, node_test_1.it)('handles Chinese text in values', () => {
        const yaml = [
            'aliases:',
            '  - 项目入口',
            '  - 主模块',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result.aliases, ['项目入口', '主模块']);
    });
    (0, node_test_1.it)('handles tags with mixed Chinese and English', () => {
        const yaml = [
            'tags:',
            '  - 核心',
            '  - frontend',
            '  - 关键路径',
        ].join('\n');
        const result = (0, yaml_1.parseSimpleYaml)(yaml);
        node_assert_1.default.deepStrictEqual(result.tags, ['核心', 'frontend', '关键路径']);
    });
});
(0, node_test_1.describe)('parseFrontmatter', () => {
    (0, node_test_1.it)('parses valid frontmatter with body', () => {
        const content = [
            '---',
            'id: card.1',
            'type: feature',
            'tags:',
            '  - pmem',
            '---',
            'This is the body text.',
            '## Section 1',
            'Some content.',
        ].join('\n');
        const result = (0, yaml_1.parseFrontmatter)(content);
        node_assert_1.default.ok(result !== null);
        node_assert_1.default.strictEqual(result.data.id, 'card.1');
        node_assert_1.default.strictEqual(result.data.type, 'feature');
        node_assert_1.default.deepStrictEqual(result.data.tags, ['pmem']);
        node_assert_1.default.ok(result.body.includes('This is the body text.'));
        node_assert_1.default.ok(result.body.includes('## Section 1'));
    });
    (0, node_test_1.it)('returns null for content without frontmatter', () => {
        const content = 'Just some markdown text\nwithout frontmatter.';
        const result = (0, yaml_1.parseFrontmatter)(content);
        node_assert_1.default.strictEqual(result, null);
    });
    (0, node_test_1.it)('handles frontmatter with empty body', () => {
        const content = [
            '---',
            'id: card.2',
            'type: task',
            '---',
            '',
        ].join('\n');
        const result = (0, yaml_1.parseFrontmatter)(content);
        node_assert_1.default.ok(result !== null);
        node_assert_1.default.strictEqual(result.data.id, 'card.2');
        node_assert_1.default.strictEqual(result.body, '');
    });
    (0, node_test_1.it)('handles frontmatter with Chinese aliases and tags', () => {
        const content = [
            '---',
            'id: feature.项目入口',
            'type: feature',
            'aliases:',
            '  - 项目入口',
            '  - 首页',
            'tags:',
            '  - 核心功能',
            '  - UI',
            '---',
            '这是项目的主要入口模块。',
        ].join('\n');
        const result = (0, yaml_1.parseFrontmatter)(content);
        node_assert_1.default.ok(result !== null);
        node_assert_1.default.strictEqual(result.data.id, 'feature.项目入口');
        node_assert_1.default.deepStrictEqual(result.data.aliases, ['项目入口', '首页']);
        node_assert_1.default.deepStrictEqual(result.data.tags, ['核心功能', 'UI']);
        node_assert_1.default.ok(result.body.includes('项目的主要入口模块'));
    });
    (0, node_test_1.it)('handles depends_on as empty array in full frontmatter', () => {
        const content = [
            '---',
            'id: feature.test',
            'type: feature',
            'depends_on: []',
            '---',
            'Body content.',
        ].join('\n');
        const result = (0, yaml_1.parseFrontmatter)(content);
        node_assert_1.default.ok(result !== null);
        node_assert_1.default.deepStrictEqual(result.data.depends_on, []);
    });
});
//# sourceMappingURL=yaml.test.js.map