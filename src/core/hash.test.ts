import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeHash, computeCardHashes, stripManagedFrontmatter, tokenCount, sectionCount } from './hash';

describe('computeHash', () => {
  it('returns a deterministic output for the same input', () => {
    const input = 'hello world';
    const hash1 = computeHash(input);
    const hash2 = computeHash(input);
    assert.strictEqual(hash1, hash2);
  });

  it('returns different hashes for different inputs', () => {
    const hash1 = computeHash('hello');
    const hash2 = computeHash('world');
    assert.notStrictEqual(hash1, hash2);
  });

  it('returns a 16-character hex string', () => {
    const hash = computeHash('test');
    assert.strictEqual(hash.length, 16);
    assert.ok(/^[0-9a-f]{16}$/.test(hash));
  });

  it('handles empty string', () => {
    const hash = computeHash('');
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 16);
  });

  it('handles long text', () => {
    const longText = 'a'.repeat(10000);
    const hash = computeHash(longText);
    assert.strictEqual(hash.length, 16);
  });
});

describe('computeCardHashes', () => {
  it('returns fileHash, frontmatterHash, and bodyHash all different', () => {
    const fullContent = '---\nid: test\n---\nBody text';
    const frontmatterText = 'id: test';
    const bodyText = 'Body text';

    const hashes = computeCardHashes(fullContent, frontmatterText, bodyText);

    assert.ok(hashes.fileHash);
    assert.ok(hashes.frontmatterHash);
    assert.ok(hashes.bodyHash);

    assert.notStrictEqual(hashes.fileHash, hashes.frontmatterHash);
    assert.notStrictEqual(hashes.fileHash, hashes.bodyHash);
    assert.notStrictEqual(hashes.frontmatterHash, hashes.bodyHash);
  });

  it('returns identical fileHash for identical full content', () => {
    const content = '---\nid: test\n---\nBody';
    const h1 = computeCardHashes(content, 'id: test', 'Body');
    const h2 = computeCardHashes(content, 'id: test', 'Body');
    assert.strictEqual(h1.fileHash, h2.fileHash);
    assert.strictEqual(h1.frontmatterHash, h2.frontmatterHash);
    assert.strictEqual(h1.bodyHash, h2.bodyHash);
  });

  it('body changes produce different bodyHash but same frontmatterHash', () => {
    const h1 = computeCardHashes(
      '---\nid: test\n---\nBody A',
      'id: test',
      'Body A'
    );
    const h2 = computeCardHashes(
      '---\nid: test\n---\nBody B',
      'id: test',
      'Body B'
    );
    assert.strictEqual(h1.frontmatterHash, h2.frontmatterHash);
    assert.notStrictEqual(h1.bodyHash, h2.bodyHash);
    assert.notStrictEqual(h1.fileHash, h2.fileHash);
  });
});

describe('tokenCount', () => {
  it('estimates English text tokens', () => {
    // ~4 chars per token
    const text = 'This is a simple English sentence for testing.';
    const count = tokenCount(text);
    assert.ok(count > 0);
    assert.ok(count < text.length);
  });

  it('estimates Chinese text tokens', () => {
    // Chinese chars are denser per token
    const text = '这是一个中文句子用于测试分词效果';
    const count = tokenCount(text);
    assert.ok(count > 0);
  });

  it('returns higher count for longer text', () => {
    const short = tokenCount('hi');
    const long = tokenCount('this is a much longer piece of text with many more words');
    assert.ok(long > short);
  });

  it('handles mixed Chinese and English text', () => {
    const text = 'This is English 和中文 mixed together';
    const count = tokenCount(text);
    assert.ok(count > 0);
  });

  it('returns 1 for very short input', () => {
    const count = tokenCount('a');
    assert.strictEqual(count, 1);
  });

  it('returns 0 for empty string', () => {
    const count = tokenCount('');
    assert.strictEqual(count, 0);
  });

  it('excludes pmem-managed frontmatter but still counts user body growth', () => {
    const metadataOnly = `---
id: decision.example
type: decision
classification: decision
trust_label: user_confirmed
sensitivity: internal
last_verified: "2026-08-02T00:00:00.000Z"
token_policy: relaxed
---
# Example
`;
    const withBody = `${metadataOnly}\n${'user memory '.repeat(30)}`;
    assert.equal(tokenCount(metadataOnly), tokenCount('# Example\n'));
    assert.ok(tokenCount(withBody) > tokenCount(metadataOnly));
    assert.equal(stripManagedFrontmatter(metadataOnly), '# Example\n');
  });

  it('preserves user-authored frontmatter in the estimate', () => {
    const withoutTags = `---\nid: module.one\ntype: module\n---\n# Module\n`;
    const withTags = `---\nid: module.one\ntype: module\ntags: [architecture, persistence, verification]\n---\n# Module\n`;
    assert.ok(tokenCount(withTags) > tokenCount(withoutTags));
  });
});

describe('sectionCount', () => {
  it('counts ## headings', () => {
    const body = '## Section 1\ncontent\n## Section 2\nmore content';
    assert.strictEqual(sectionCount(body), 2);
  });

  it('returns 0 for body with no ## headings', () => {
    const body = 'Just some text\nwith no headings at all.';
    assert.strictEqual(sectionCount(body), 0);
  });

  it('does not count ### sub-headings', () => {
    const body = '## Main\n### Sub\n### Sub2\n## Main2';
    assert.strictEqual(sectionCount(body), 2);
  });

  it('does not count # h1 headings', () => {
    const body = '# Title\n## Section 1\nContent';
    assert.strictEqual(sectionCount(body), 1);
  });

  it('returns 0 for empty body', () => {
    assert.strictEqual(sectionCount(''), 0);
  });
});
