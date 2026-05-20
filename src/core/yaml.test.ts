import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSimpleYaml, parseYamlValue, parseFrontmatter } from './yaml';

describe('parseYamlValue', () => {
  it('parses strings', () => {
    assert.strictEqual(parseYamlValue('hello'), 'hello');
    assert.strictEqual(parseYamlValue('hello world'), 'hello world');
  });

  it('parses booleans', () => {
    assert.strictEqual(parseYamlValue('true'), true);
    assert.strictEqual(parseYamlValue('false'), false);
  });

  it('parses numbers', () => {
    assert.strictEqual(parseYamlValue('0'), 0);
    assert.strictEqual(parseYamlValue('123'), 123);
    assert.strictEqual(parseYamlValue('999'), 999);
  });

  it('parses inline arrays', () => {
    assert.deepStrictEqual(parseYamlValue('[a, b, c]'), ['a', 'b', 'c']);
    assert.deepStrictEqual(parseYamlValue('[foo, bar]'), ['foo', 'bar']);
  });

  it('parses empty inline array as empty array', () => {
    const result = parseYamlValue('[]');
    assert.ok(Array.isArray(result));
    assert.strictEqual((result as string[]).length, 0);
    // Ensure it is NOT ['']
    assert.deepStrictEqual(result, []);
  });

  it('parses single-element inline array', () => {
    assert.deepStrictEqual(parseYamlValue('[only]'), ['only']);
  });

  it('parses quoted strings', () => {
    assert.strictEqual(parseYamlValue('"hello"'), 'hello');
    assert.strictEqual(parseYamlValue('"quoted string"'), 'quoted string');
  });

  it('parses quoted strings inside arrays', () => {
    assert.deepStrictEqual(parseYamlValue('["hello", world]'), ['hello', 'world']);
  });
});

describe('parseSimpleYaml', () => {
  it('parses simple key-value pairs', () => {
    const result = parseSimpleYaml('key: value');
    assert.deepStrictEqual(result, { key: 'value' });
  });

  it('parses nested objects', () => {
    const yaml = [
      'person:',
      '  name: John',
      '  age: 30',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result, {
      person: { name: 'John', age: 30 },
    });
  });

  it('parses list items', () => {
    const yaml = [
      'tags:',
      '  - tag1',
      '  - tag2',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result, {
      tags: ['tag1', 'tag2'],
    });
  });

  it('parses list items with single nesting level', () => {
    const yaml = [
      'tags:',
      '  - dev',
      '  - js',
      '  - ops',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result, {
      tags: ['dev', 'js', 'ops'],
    });
  });

  it('parses top-level values with different types', () => {
    const yaml = [
      'id: test.id',
      'type: feature',
      'priority: high',
      'version: 3',
      'active: true',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.strictEqual(result.id, 'test.id');
    assert.strictEqual(result.type, 'feature');
    assert.strictEqual(result.priority, 'high');
    assert.strictEqual(result.version, 3);
    assert.strictEqual(result.active, true);
  });

  it('parses depends_on with empty inline array', () => {
    const yaml = [
      'id: test.id',
      'depends_on: []',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.depends_on, []);
  });

  it('parses depends_on with items via list syntax', () => {
    const yaml = [
      'depends_on:',
      '  - card-a',
      '  - card-b',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.depends_on, ['card-a', 'card-b']);
  });

  it('handles Chinese text in values', () => {
    const yaml = [
      'aliases:',
      '  - 项目入口',
      '  - 主模块',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.aliases, ['项目入口', '主模块']);
  });

  it('handles tags with mixed Chinese and English', () => {
    const yaml = [
      'tags:',
      '  - 核心',
      '  - frontend',
      '  - 关键路径',
    ].join('\n');
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.tags, ['核心', 'frontend', '关键路径']);
  });
});

describe('parseFrontmatter', () => {
  it('parses valid frontmatter with body', () => {
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
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.strictEqual(result!.data.id, 'card.1');
    assert.strictEqual(result!.data.type, 'feature');
    assert.deepStrictEqual(result!.data.tags, ['pmem']);
    assert.ok(result!.body.includes('This is the body text.'));
    assert.ok(result!.body.includes('## Section 1'));
  });

  it('returns null for content without frontmatter', () => {
    const content = 'Just some markdown text\nwithout frontmatter.';
    const result = parseFrontmatter(content);
    assert.strictEqual(result, null);
  });

  it('handles frontmatter with empty body', () => {
    const content = [
      '---',
      'id: card.2',
      'type: task',
      '---',
      '',
    ].join('\n');
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.strictEqual(result!.data.id, 'card.2');
    assert.strictEqual(result!.body, '');
  });

  it('handles frontmatter with Chinese aliases and tags', () => {
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
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.strictEqual(result!.data.id, 'feature.项目入口');
    assert.deepStrictEqual(result!.data.aliases, ['项目入口', '首页']);
    assert.deepStrictEqual(result!.data.tags, ['核心功能', 'UI']);
    assert.ok(result!.body.includes('项目的主要入口模块'));
  });

  it('handles depends_on as empty array in full frontmatter', () => {
    const content = [
      '---',
      'id: feature.test',
      'type: feature',
      'depends_on: []',
      '---',
      'Body content.',
    ].join('\n');
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.deepStrictEqual(result!.data.depends_on, []);
  });
});
